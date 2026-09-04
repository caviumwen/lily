import express from 'express';
import multer from 'multer';

import {
  configurationStatus,
  deleteObject,
  deleteRow,
  getObject,
  getRow,
  putObject,
  putRow,
  scanRows,
  updateRow,
  verifyTables,
} from './store.js';
import {
  PASSWORD_ITERATIONS,
  addMonthsIso,
  clearCookie,
  clientAddress,
  generateAccessCode,
  makeId,
  normalizeAccessCode,
  nowIso,
  parseCookies,
  passwordHash,
  randomToken,
  secureEqual,
  sessionCookie,
  sha256,
} from './security.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '512kb' }));
app.use((request, response, next) => {
  response.set({
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
  });
  next();
});

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function sendError(response, status, message) {
  response.status(status).json({ error: message });
}

function isActive(report) {
  return report?.status === 'active';
}

async function createSession(sessionType, options) {
  const token = randomToken();
  const tokenHash = sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + options.hours * 3_600_000);
  await putRow('sessions', tokenHash, {
    token_hash: tokenHash,
    session_type: sessionType,
    report_id: options.reportId,
    admin_id: options.adminId,
    expires_at: expiresAt.toISOString(),
    created_at: createdAt.toISOString(),
  });
  return { token, expiresAt };
}

async function getSession(request, sessionType) {
  const cookieName = sessionType === 'admin' ? 'lp_admin' : 'lp_report';
  const token = parseCookies(request).get(cookieName);
  if (!token) return null;
  const tokenHash = sha256(token);
  const session = await getRow('sessions', tokenHash);
  if (
    !session ||
    session.session_type !== sessionType ||
    new Date(session.expires_at) <= new Date()
  ) {
    if (session) await deleteRow('sessions', tokenHash);
    return null;
  }
  return session;
}

async function deleteSession(request, sessionType) {
  const cookieName = sessionType === 'admin' ? 'lp_admin' : 'lp_report';
  const token = parseCookies(request).get(cookieName);
  if (token) await deleteRow('sessions', sha256(token));
}

async function deleteReportSessions(reportId) {
  const sessions = await scanRows('sessions');
  await Promise.all(
    sessions
      .filter(
        (session) =>
          session.session_type === 'report' && session.report_id === reportId,
      )
      .map((session) => deleteRow('sessions', session.token_hash)),
  );
}

async function requireAdmin(request, response) {
  const session = await getSession(request, 'admin');
  if (!session) {
    sendError(response, 401, '请先登录管理后台。');
    return null;
  }
  return session;
}

async function rateState(request, scope) {
  const limiterKey = sha256(`${scope}:${clientAddress(request)}`);
  const row = await getRow('rateLimits', limiterKey);
  if (row?.blocked_until && new Date(row.blocked_until) > new Date()) {
    return { allowed: false, limiterKey, retryAt: row.blocked_until };
  }
  return { allowed: true, limiterKey };
}

async function recordRateFailure(limiterKey) {
  const current = new Date();
  const windowStart = new Date(current.getTime() - 15 * 60_000);
  const existing = await getRow('rateLimits', limiterKey);
  const withinWindow =
    existing && new Date(existing.window_started_at) > windowStart;
  const attempts = withinWindow ? Number(existing.attempts || 0) + 1 : 1;
  const startedAt = withinWindow
    ? existing.window_started_at
    : current.toISOString();
  const blockedUntil =
    attempts >= 5
      ? new Date(current.getTime() + 15 * 60_000).toISOString()
      : null;
  await putRow('rateLimits', limiterKey, {
    limiter_key: limiterKey,
    attempts,
    window_started_at: startedAt,
    blocked_until: blockedUntil,
  });
}

async function clearRateLimit(limiterKey) {
  await deleteRow('rateLimits', limiterKey);
}

async function recordAccessEvent(reportId, success) {
  const eventId = makeId('evt');
  await putRow('accessEvents', eventId, {
    event_id: eventId,
    report_id: reportId,
    event_type: 'code_attempt',
    success: success ? 1 : 0,
    created_at: nowIso(),
  });
}

async function attachmentsFor(reportId) {
  const rows = await scanRows('attachments');
  return rows
    .filter((attachment) => attachment.report_id === reportId)
    .sort((left, right) =>
      String(right.created_at).localeCompare(String(left.created_at)),
    );
}

async function accessCodesFor(reportId) {
  const rows = await scanRows('accessCodes');
  return rows
    .filter((code) => code.report_id === reportId)
    .sort((left, right) =>
      String(right.created_at).localeCompare(String(left.created_at)),
    );
}

app.get(
  '/api/health',
  asyncRoute(async (_request, response) => {
    const config = configurationStatus();
    if (config.missingConfiguration.length || config.missingRoleCredentials.length) {
      return response.status(503).json({ ok: false, code: 'CONFIGURATION_INCOMPLETE' });
    }
    await verifyTables();
    response.json({ ok: true });
  }),
);

app.use('/api', (request, response, next) => {
  if (request.get('x-lilyplan-proxy') !== 'esa') {
    return sendError(response, 403, '请求来源未通过网站代理。');
  }
  next();
});

app.post(
  '/api/access',
  asyncRoute(async (request, response) => {
    const rate = await rateState(request, 'customer-access');
    if (!rate.allowed) {
      return sendError(response, 429, '尝试次数过多，请在15分钟后再试。');
    }
    const normalized = normalizeAccessCode(request.body?.code);
    if (normalized.length < 8) {
      return sendError(response, 400, '请输入完整的访问码。');
    }
    const codeHash = sha256(normalized);
    const code = await getRow('accessCodes', codeHash);
    const report = code?.report_id
      ? await getRow('reports', code.report_id)
      : null;
    const valid =
      code &&
      !code.revoked_at &&
      isActive(report) &&
      new Date(code.expires_at) > new Date();
    if (!valid) {
      await Promise.all([
        recordRateFailure(rate.limiterKey),
        recordAccessEvent(code?.report_id, false),
      ]);
      return sendError(response, 401, '访问码无效、已到期或已被撤销。');
    }
    await clearRateLimit(rate.limiterKey);
    const session = await createSession('report', {
      reportId: code.report_id,
      hours: 24,
    });
    const timestamp = nowIso();
    await Promise.all([
      updateRow('reports', code.report_id, {
        access_count: Number(report.access_count || 0) + 1,
        last_access_at: timestamp,
      }),
      recordAccessEvent(code.report_id, true),
    ]);
    response.set(
      'Set-Cookie',
      sessionCookie('lp_report', session.token, 86_400),
    );
    response.json({ ok: true, redirect: '/report' });
  }),
);

app.get(
  '/api/report',
  asyncRoute(async (request, response) => {
    const session = await getSession(request, 'report');
    if (!session?.report_id) {
      return sendError(response, 401, '请先输入有效访问码。');
    }
    const report = await getRow('reports', session.report_id);
    if (!isActive(report)) {
      return sendError(response, 404, '该方案已暂停查看。');
    }
    const attachments = await attachmentsFor(report.report_id);
    response.json({
      report: {
        id: report.report_id,
        customer_name: report.customer_name,
        title: report.title,
        summary: report.summary || '',
        content: report.content || '',
        updated_at: report.updated_at,
        content_mode: report.content_mode || 'text',
        html_filename: report.html_filename || null,
        attachments: attachments.map((attachment) => ({
          id: attachment.attachment_id,
          filename: attachment.filename,
          content_type: attachment.content_type,
          size: Number(attachment.size || 0),
          created_at: attachment.created_at,
        })),
      },
    });
  }),
);

app.get(
  '/api/report/html',
  asyncRoute(async (request, response) => {
    const session = await getSession(request, 'report');
    if (!session?.report_id) {
      return sendError(response, 401, '请先输入有效访问码。');
    }
    const report = await getRow('reports', session.report_id);
    if (
      !isActive(report) ||
      report.content_mode !== 'html' ||
      !report.html_object_key
    ) {
      return sendError(response, 404, '该 HTML 方案不存在或已暂停。');
    }
    const object = await getObject(report.html_object_key);
    if (!object) return sendError(response, 404, 'HTML 文件不存在。');
    response.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': [
        "default-src 'none'",
        "style-src 'self' 'unsafe-inline' https:",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        "media-src 'self' data: https:",
        "script-src 'none'",
        "connect-src 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "frame-ancestors 'self'",
        "form-action 'none'",
        "base-uri 'none'",
      ].join('; '),
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'no-referrer',
    });
    response.send(object.content);
  }),
);

app.post(
  '/api/report/logout',
  asyncRoute(async (request, response) => {
    await deleteSession(request, 'report');
    response.set('Set-Cookie', clearCookie('lp_report'));
    response.json({ ok: true });
  }),
);

app.get(
  '/api/files/:id',
  asyncRoute(async (request, response) => {
    const [adminSession, reportSession, attachment] = await Promise.all([
      getSession(request, 'admin'),
      getSession(request, 'report'),
      getRow('attachments', request.params.id),
    ]);
    if (!attachment) return sendError(response, 404, '文件不存在。');
    const report = await getRow('reports', attachment.report_id);
    if (
      !adminSession &&
      (reportSession?.report_id !== attachment.report_id || !isActive(report))
    ) {
      return sendError(response, 403, '无权查看该文件。');
    }
    const object = await getObject(attachment.object_key);
    if (!object) return sendError(response, 404, '文件不存在。');
    response.set({
      'Content-Type': attachment.content_type,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    });
    response.send(object.content);
  }),
);

app.delete(
  '/api/files/:id',
  asyncRoute(async (request, response) => {
    if (!(await requireAdmin(request, response))) return;
    const attachment = await getRow('attachments', request.params.id);
    if (!attachment) return sendError(response, 404, '文件不存在。');
    await deleteObject(attachment.object_key);
    await deleteRow('attachments', request.params.id);
    response.json({ ok: true });
  }),
);

app.get(
  '/api/admin/status',
  asyncRoute(async (request, response) => {
    const [admins, session] = await Promise.all([
      scanRows('admins', 1),
      getSession(request, 'admin'),
    ]);
    response.json({
      configured: admins.length > 0,
      authenticated: Boolean(session),
    });
  }),
);

app.post(
  '/api/admin/setup',
  asyncRoute(async (request, response) => {
    const admins = await scanRows('admins', 1);
    if (admins.length) {
      return sendError(response, 409, '管理员已经初始化。');
    }
    const username = String(request.body?.username || '').trim();
    const password = String(request.body?.password || '');
    if (username.length < 2 || password.length < 12) {
      return sendError(
        response,
        400,
        '管理员名称至少2个字符，密码至少12个字符。',
      );
    }
    const salt = randomToken(20);
    const adminId = makeId('adm');
    await putRow(
      'admins',
      username,
      {
        admin_id: adminId,
        username,
        password_salt: salt,
        password_hash: await passwordHash(password, salt),
        password_iterations: PASSWORD_ITERATIONS,
        created_at: nowIso(),
      },
      { expectNotExist: true },
    );
    const session = await createSession('admin', {
      adminId,
      hours: 12,
    });
    response.set(
      'Set-Cookie',
      sessionCookie('lp_admin', session.token, 43_200),
    );
    response.json({ ok: true });
  }),
);

app.post(
  '/api/admin/login',
  asyncRoute(async (request, response) => {
    const rate = await rateState(request, 'admin-login');
    if (!rate.allowed) {
      return sendError(response, 429, '登录失败次数过多，请在15分钟后再试。');
    }
    const username = String(request.body?.username || '').trim();
    const password = String(request.body?.password || '');
    const admin = username ? await getRow('admins', username) : null;
    const supplied = admin
      ? await passwordHash(
          password,
          admin.password_salt,
          Number(admin.password_iterations || 100_000),
        )
      : '';
    if (!admin || !secureEqual(supplied, admin.password_hash)) {
      await recordRateFailure(rate.limiterKey);
      return sendError(response, 401, '管理员名称或密码错误。');
    }
    await clearRateLimit(rate.limiterKey);
    const session = await createSession('admin', {
      adminId: admin.admin_id,
      hours: 12,
    });
    response.set(
      'Set-Cookie',
      sessionCookie('lp_admin', session.token, 43_200),
    );
    response.json({ ok: true });
  }),
);

app.post(
  '/api/admin/logout',
  asyncRoute(async (request, response) => {
    await deleteSession(request, 'admin');
    response.set('Set-Cookie', clearCookie('lp_admin'));
    response.json({ ok: true });
  }),
);

app.get(
  '/api/admin/reports',
  asyncRoute(async (request, response) => {
    if (!(await requireAdmin(request, response))) return;
    const [reports, codes, attachments] = await Promise.all([
      scanRows('reports'),
      scanRows('accessCodes'),
      scanRows('attachments'),
    ]);
    const latestCodes = new Map();
    for (const code of codes) {
      const current = latestCodes.get(code.report_id);
      if (!current || String(code.created_at) > String(current.created_at)) {
        latestCodes.set(code.report_id, code);
      }
    }
    const counts = new Map();
    for (const attachment of attachments) {
      counts.set(
        attachment.report_id,
        Number(counts.get(attachment.report_id) || 0) + 1,
      );
    }
    const result = reports
      .sort((left, right) =>
        String(right.updated_at).localeCompare(String(left.updated_at)),
      )
      .map((report) => {
        const code = latestCodes.get(report.report_id);
        return {
          id: report.report_id,
          customer_name: report.customer_name,
          title: report.title,
          summary: report.summary || '',
          status: report.status,
          access_count: Number(report.access_count || 0),
          last_access_at: report.last_access_at || null,
          created_at: report.created_at,
          updated_at: report.updated_at,
          content_mode: report.content_mode || 'text',
          html_filename: report.html_filename || null,
          code_hint: code?.code_hint || null,
          expires_at: code?.expires_at || null,
          revoked_at: code?.revoked_at || null,
          attachment_count: Number(counts.get(report.report_id) || 0),
        };
      });
    response.json({ reports: result });
  }),
);

app.post(
  '/api/admin/reports',
  asyncRoute(async (request, response) => {
    if (!(await requireAdmin(request, response))) return;
    const customerName = String(request.body?.customerName || '').trim();
    const title = String(request.body?.title || '').trim();
    const summary = String(request.body?.summary || '').trim();
    const content = String(request.body?.content || '').trim();
    const contentMode = request.body?.contentMode === 'html' ? 'html' : 'text';
    if (!customerName || !title || (contentMode === 'text' && !content)) {
      return sendError(
        response,
        400,
        '客户称呼、方案标题和文字正文不能为空。',
      );
    }
    if (
      customerName.length > 80 ||
      title.length > 160 ||
      content.length > 100_000
    ) {
      return sendError(response, 400, '部分文字内容超过允许长度。');
    }
    const reportId = makeId('rpt');
    const accessCode = generateAccessCode();
    const codeHash = sha256(normalizeAccessCode(accessCode));
    const timestamp = nowIso();
    const expiresAt = addMonthsIso(3);
    await putRow('reports', reportId, {
      report_id: reportId,
      customer_name: customerName,
      title,
      summary,
      content,
      content_mode: contentMode,
      status: contentMode === 'html' ? 'archived' : 'active',
      access_count: 0,
      created_at: timestamp,
      updated_at: timestamp,
    });
    try {
      await putRow('accessCodes', codeHash, {
        code_hash: codeHash,
        code_id: makeId('code'),
        report_id: reportId,
        code_hint: accessCode.slice(-4),
        expires_at: expiresAt,
        created_at: timestamp,
      });
    } catch (error) {
      await deleteRow('reports', reportId);
      throw error;
    }
    response.status(201).json({ reportId, accessCode, expiresAt });
  }),
);

app.get(
  '/api/admin/reports/:id',
  asyncRoute(async (request, response) => {
    if (!(await requireAdmin(request, response))) return;
    const report = await getRow('reports', request.params.id);
    if (!report) return sendError(response, 404, '方案不存在。');
    const attachments = await attachmentsFor(report.report_id);
    response.json({
      report: {
        id: report.report_id,
        customer_name: report.customer_name,
        title: report.title,
        summary: report.summary || '',
        content: report.content || '',
        status: report.status,
        access_count: Number(report.access_count || 0),
        last_access_at: report.last_access_at || null,
        created_at: report.created_at,
        updated_at: report.updated_at,
        content_mode: report.content_mode || 'text',
        html_filename: report.html_filename || null,
        html_size: Number(report.html_size || 0),
        attachments: attachments.map((attachment) => ({
          id: attachment.attachment_id,
          filename: attachment.filename,
          content_type: attachment.content_type,
          size: Number(attachment.size || 0),
          created_at: attachment.created_at,
        })),
      },
    });
  }),
);

app.put(
  '/api/admin/reports/:id',
  asyncRoute(async (request, response) => {
    if (!(await requireAdmin(request, response))) return;
    const report = await getRow('reports', request.params.id);
    if (!report) return sendError(response, 404, '方案不存在。');
    const customerName = String(request.body?.customerName || '').trim();
    const title = String(request.body?.title || '').trim();
    const summary = String(request.body?.summary || '').trim();
    const content = String(request.body?.content || '').trim();
    const status = request.body?.status === 'archived' ? 'archived' : 'active';
    const contentMode = request.body?.contentMode === 'html' ? 'html' : 'text';
    if (!customerName || !title || (contentMode === 'text' && !content)) {
      return sendError(
        response,
        400,
        '客户称呼、方案标题和文字正文不能为空。',
      );
    }
    if (contentMode === 'html' && !report.html_object_key) {
      return sendError(response, 400, '请先选择并上传 HTML 文件。');
    }
    await updateRow('reports', report.report_id, {
      customer_name: customerName,
      title,
      summary,
      content,
      status,
      content_mode: contentMode,
      updated_at: nowIso(),
    });
    if (status === 'archived') await deleteReportSessions(report.report_id);
    response.json({ ok: true });
  }),
);

app.post(
  '/api/admin/reports/:id/html',
  upload.single('file'),
  asyncRoute(async (request, response) => {
    if (!(await requireAdmin(request, response))) return;
    const report = await getRow('reports', request.params.id);
    if (!report) return sendError(response, 404, '方案不存在。');
    const file = request.file;
    if (!file) return sendError(response, 400, '请选择 HTML 文件。');
    const lowerName = file.originalname.toLowerCase();
    if (
      file.mimetype !== 'text/html' &&
      !lowerName.endsWith('.html') &&
      !lowerName.endsWith('.htm')
    ) {
      return sendError(response, 400, '仅支持 .html 或 .htm 文件。');
    }
    if (file.size > 5 * 1024 * 1024) {
      return sendError(response, 400, 'HTML 文件不能超过5MB。');
    }
    const safeName =
      file.originalname.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120) ||
      'report.html';
    const objectKey = `reports/${report.report_id}/html-${makeId('doc')}-${safeName}`;
    await putObject(objectKey, file.buffer, 'text/html; charset=utf-8');
    try {
      await updateRow('reports', report.report_id, {
        content_mode: 'html',
        html_object_key: objectKey,
        html_filename: file.originalname.slice(0, 180),
        html_size: file.size,
        updated_at: nowIso(),
      });
    } catch (error) {
      await deleteObject(objectKey);
      throw error;
    }
    if (report.html_object_key && report.html_object_key !== objectKey) {
      await deleteObject(report.html_object_key);
    }
    response.status(201).json({
      filename: file.originalname,
      size: file.size,
    });
  }),
);

app.post(
  '/api/admin/reports/:id/code',
  asyncRoute(async (request, response) => {
    if (!(await requireAdmin(request, response))) return;
    const report = await getRow('reports', request.params.id);
    if (!report) return sendError(response, 404, '方案不存在。');
    const action = request.body?.action || 'regenerate';
    const codes = await accessCodesFor(report.report_id);
    const latest = codes[0];
    const timestamp = nowIso();
    if (action === 'revoke') {
      await Promise.all(
        codes
          .filter((code) => !code.revoked_at)
          .map((code) =>
            updateRow('accessCodes', code.code_hash, { revoked_at: timestamp }),
          ),
      );
      await deleteReportSessions(report.report_id);
      return response.json({ ok: true });
    }
    if (action === 'renew') {
      if (!latest || latest.revoked_at) {
        return sendError(
          response,
          409,
          '当前没有可续期的访问码，请重新生成。',
        );
      }
      const base =
        new Date(latest.expires_at) > new Date()
          ? new Date(latest.expires_at)
          : new Date();
      const expiresAt = addMonthsIso(3, base);
      await updateRow('accessCodes', latest.code_hash, { expires_at: expiresAt });
      return response.json({ ok: true, expiresAt });
    }
    await Promise.all(
      codes
        .filter((code) => !code.revoked_at)
        .map((code) =>
          updateRow('accessCodes', code.code_hash, { revoked_at: timestamp }),
        ),
    );
    await deleteReportSessions(report.report_id);
    const accessCode = generateAccessCode();
    const codeHash = sha256(normalizeAccessCode(accessCode));
    const expiresAt = addMonthsIso(3);
    await putRow('accessCodes', codeHash, {
      code_hash: codeHash,
      code_id: makeId('code'),
      report_id: report.report_id,
      code_hint: accessCode.slice(-4),
      expires_at: expiresAt,
      created_at: timestamp,
    });
    response.json({ accessCode, expiresAt });
  }),
);

app.post(
  '/api/admin/reports/:id/preview',
  asyncRoute(async (request, response) => {
    if (!(await requireAdmin(request, response))) return;
    const report = await getRow('reports', request.params.id);
    if (!report) return sendError(response, 404, '方案不存在。');
    const session = await createSession('report', {
      reportId: report.report_id,
      hours: 1,
    });
    response.set(
      'Set-Cookie',
      sessionCookie('lp_report', session.token, 3_600),
    );
    response.json({ ok: true, redirect: '/report' });
  }),
);

const allowedAttachmentTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
]);

app.post(
  '/api/admin/files',
  upload.single('file'),
  asyncRoute(async (request, response) => {
    if (!(await requireAdmin(request, response))) return;
    const reportId = String(request.body?.reportId || '');
    const file = request.file;
    if (!reportId || !file) {
      return sendError(response, 400, '请选择要上传的文件。');
    }
    const report = await getRow('reports', reportId);
    if (!report) return sendError(response, 404, '方案不存在。');
    if (!allowedAttachmentTypes.has(file.mimetype)) {
      return sendError(
        response,
        400,
        '仅支持 PDF、JPG、PNG、WebP 或 TXT 文件。',
      );
    }
    const attachmentId = makeId('att');
    const safeName =
      file.originalname.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120) ||
      'attachment';
    const objectKey = `reports/${reportId}/${attachmentId}-${safeName}`;
    await putObject(objectKey, file.buffer, file.mimetype);
    try {
      await putRow('attachments', attachmentId, {
        attachment_id: attachmentId,
        report_id: reportId,
        object_key: objectKey,
        filename: file.originalname.slice(0, 180),
        content_type: file.mimetype,
        size: file.size,
        created_at: nowIso(),
      });
    } catch (error) {
      await deleteObject(objectKey);
      throw error;
    }
    response.status(201).json({ id: attachmentId, filename: file.originalname });
  }),
);

app.use('/api', (_request, response) => {
  sendError(response, 404, '接口不存在。');
});

app.use((error, request, response, _next) => {
  const requestId = request.get('x-fc-request-id') || makeId('req');
  console.error(
    JSON.stringify({
      level: 'error',
      requestId,
      path: request.path,
      code: error?.code || error?.name || 'UNKNOWN',
      message: error?.message || 'Unknown server error',
    }),
  );
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return sendError(response, 413, '上传文件超过允许大小。');
  }
  sendError(response, 500, '服务器暂时无法处理请求，请稍后重试。');
});

const port = Number(process.env.FC_CUSTOM_LISTEN_PORT || process.env.PORT || 9000);
app.listen(port, '0.0.0.0', () => {
  const config = configurationStatus();
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'LilyPlan API started',
      port,
      configurationReady:
        config.missingConfiguration.length === 0 &&
        config.missingRoleCredentials.length === 0,
    }),
  );
});

