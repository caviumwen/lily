import OSS from 'ali-oss';
import TableStore from 'tablestore';

const TABLES = Object.freeze({
  admins: process.env.TABLE_ADMINS || 'lp_admins',
  reports: process.env.TABLE_REPORTS || 'lp_reports',
  accessCodes: process.env.TABLE_ACCESS_CODES || 'lp_access_codes',
  sessions: process.env.TABLE_SESSIONS || 'lp_sessions',
  attachments: process.env.TABLE_ATTACHMENTS || 'lp_attachments',
  rateLimits: process.env.TABLE_RATE_LIMITS || 'lp_rate_limits',
  accessEvents: process.env.TABLE_ACCESS_EVENTS || 'lp_access_events',
});

const REQUIRED_ENV = [
  'TABLESTORE_INSTANCE',
  'TABLESTORE_ENDPOINT',
  'OSS_REGION',
  'OSS_BUCKET',
];

const ROLE_ENV = [
  'ALIBABA_CLOUD_ACCESS_KEY_ID',
  'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
  'ALIBABA_CLOUD_SECURITY_TOKEN',
];

let tableStoreClient;
let objectStoreClient;
const primaryKeyCache = new Map();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function configurationStatus() {
  return {
    missingConfiguration: REQUIRED_ENV.filter((name) => !process.env[name]),
    missingRoleCredentials: ROLE_ENV.filter((name) => !process.env[name]),
  };
}

function credentials() {
  return {
    accessKeyId: required('ALIBABA_CLOUD_ACCESS_KEY_ID'),
    accessKeySecret: required('ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
    stsToken: required('ALIBABA_CLOUD_SECURITY_TOKEN'),
  };
}

function tableClient() {
  if (!tableStoreClient) {
    const auth = credentials();
    tableStoreClient = new TableStore.Client({
      accessKeyId: auth.accessKeyId,
      secretAccessKey: auth.accessKeySecret,
      stsToken: auth.stsToken,
      endpoint: required('TABLESTORE_ENDPOINT'),
      instancename: required('TABLESTORE_INSTANCE'),
      maxRetries: 3,
    });
  }
  return tableStoreClient;
}

function ossClient() {
  if (!objectStoreClient) {
    const auth = credentials();
    objectStoreClient = new OSS({
      region: required('OSS_REGION'),
      bucket: required('OSS_BUCKET'),
      endpoint:
        process.env.OSS_ENDPOINT ||
        `https://${required('OSS_REGION')}-internal.aliyuncs.com`,
      secure: true,
      accessKeyId: auth.accessKeyId,
      accessKeySecret: auth.accessKeySecret,
      stsToken: auth.stsToken,
      timeout: 60_000,
      refreshSTSTokenInterval: 300_000,
      refreshSTSToken: async () => ({
        accessKeyId: required('ALIBABA_CLOUD_ACCESS_KEY_ID'),
        accessKeySecret: required('ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
        stsToken: required('ALIBABA_CLOUD_SECURITY_TOKEN'),
      }),
    });
  }
  return objectStoreClient;
}

function logicalTable(logicalName) {
  const tableName = TABLES[logicalName];
  if (!tableName) throw new Error(`Unknown table: ${logicalName}`);
  return tableName;
}

async function primaryKeyName(logicalName) {
  if (!primaryKeyCache.has(logicalName)) {
    const promise = tableClient()
      .describeTable({ tableName: logicalTable(logicalName) })
      .then((description) => {
        const keys = description?.tableMeta?.primaryKey || [];
        if (keys.length !== 1) {
          throw new Error(
            `${logicalTable(logicalName)} must contain exactly one string primary key`,
          );
        }
        return keys[0].name;
      })
      .catch((error) => {
        primaryKeyCache.delete(logicalName);
        throw error;
      });
    primaryKeyCache.set(logicalName, promise);
  }
  return primaryKeyCache.get(logicalName);
}

function decodeValue(value) {
  if (
    value &&
    typeof value === 'object' &&
    typeof value.toNumber === 'function' &&
    typeof value.toString === 'function'
  ) {
    const number = value.toNumber();
    return Number.isSafeInteger(number) ? number : value.toString();
  }
  return value;
}

function encodeValue(value) {
  if (Number.isInteger(value)) return TableStore.Long.fromNumber(value);
  return value;
}

function rowToObject(row) {
  if (!row?.primaryKey?.length) return null;
  const output = {};
  for (const key of row.primaryKey) output[key.name] = decodeValue(key.value);
  for (const column of row.attributes || []) {
    output[column.columnName] = decodeValue(column.columnValue);
  }
  return output;
}

function attributeColumns(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => ({ [name]: encodeValue(value) }));
}

function existence(expectation) {
  return new TableStore.Condition(expectation, null);
}

export async function getRow(logicalName, keyValue) {
  const keyName = await primaryKeyName(logicalName);
  const result = await tableClient().getRow({
    tableName: logicalTable(logicalName),
    primaryKey: [{ [keyName]: keyValue }],
    maxVersions: 1,
  });
  return rowToObject(result.row);
}

export async function putRow(logicalName, keyValue, attributes, options = {}) {
  const keyName = await primaryKeyName(logicalName);
  return tableClient().putRow({
    tableName: logicalTable(logicalName),
    condition: existence(
      options.expectNotExist
        ? TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST
        : TableStore.RowExistenceExpectation.IGNORE,
    ),
    primaryKey: [{ [keyName]: keyValue }],
    attributeColumns: attributeColumns(attributes),
  });
}

export async function updateRow(logicalName, keyValue, attributes) {
  const keyName = await primaryKeyName(logicalName);
  const toPut = attributeColumns(attributes);
  const toDelete = Object.entries(attributes)
    .filter(([, value]) => value === null)
    .map(([name]) => name);
  const updates = [];
  if (toPut.length) updates.push({ PUT: toPut });
  if (toDelete.length) updates.push({ DELETE_ALL: toDelete });
  if (!updates.length) return;
  return tableClient().updateRow({
    tableName: logicalTable(logicalName),
    condition: existence(TableStore.RowExistenceExpectation.EXPECT_EXIST),
    primaryKey: [{ [keyName]: keyValue }],
    updateOfAttributeColumns: updates,
  });
}

export async function deleteRow(logicalName, keyValue) {
  const keyName = await primaryKeyName(logicalName);
  return tableClient().deleteRow({
    tableName: logicalTable(logicalName),
    condition: existence(TableStore.RowExistenceExpectation.IGNORE),
    primaryKey: [{ [keyName]: keyValue }],
  });
}

export async function scanRows(logicalName, maximum = 5_000) {
  const keyName = await primaryKeyName(logicalName);
  const params = {
    tableName: logicalTable(logicalName),
    direction: TableStore.Direction.FORWARD,
    maxVersions: 1,
    inclusiveStartPrimaryKey: [{ [keyName]: TableStore.INF_MIN }],
    exclusiveEndPrimaryKey: [{ [keyName]: TableStore.INF_MAX }],
    limit: Math.min(200, maximum),
  };
  const rows = [];
  while (rows.length < maximum) {
    const result = await tableClient().getRange(params);
    rows.push(...(result.rows || []).map(rowToObject).filter(Boolean));
    if (!result.nextStartPrimaryKey) break;
    params.inclusiveStartPrimaryKey = result.nextStartPrimaryKey.map((key) => ({
      [key.name]: key.value,
    }));
    params.limit = Math.min(200, maximum - rows.length);
  }
  return rows;
}

export async function verifyTables() {
  const names = Object.keys(TABLES);
  await Promise.all(names.map((name) => primaryKeyName(name)));
  return names.map((name) => TABLES[name]);
}

export async function putObject(objectKey, content, contentType) {
  return ossClient().put(objectKey, content, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function getObject(objectKey) {
  try {
    const result = await ossClient().get(objectKey);
    return {
      content: result.content,
      headers: result.res?.headers || {},
    };
  } catch (error) {
    if (error?.code === 'NoSuchKey' || error?.status === 404) return null;
    throw error;
  }
}

export async function deleteObject(objectKey) {
  try {
    await ossClient().delete(objectKey);
  } catch (error) {
    if (error?.code !== 'NoSuchKey' && error?.status !== 404) throw error;
  }
}

