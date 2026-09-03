'use client';

import { useState } from 'react';
import { ArrowRight, KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AccessForm() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = await response.text();
      let result: { error?: string; redirect?: string };
      try {
        result = body ? JSON.parse(body) : {};
      } catch {
        throw new Error('服务器响应异常，请稍后重试。');
      }
      if (!response.ok) {
        setError(result.error ?? '暂时无法验证，请稍后重试。');
        return;
      }
      window.location.assign(result.redirect ?? '/report');
    } catch {
      setError('网络连接失败，请检查网络后重试。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="access-card">
      <CardHeader className="access-card-header">
        <span className="key-icon">
          <KeyRound aria-hidden="true" />
        </span>
        <div>
          <p>客户验证</p>
          <h2>输入访问码</h2>
        </div>
      </CardHeader>
      <CardContent>
        <form className="access-form" onSubmit={submit}>
          <Label htmlFor="access-code">您的专属访问码</Label>
          <Input
            id="access-code"
            name="accessCode"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="例如：K7QM-4N8P-X2RF"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={20}
            className="code-input"
            aria-invalid={Boolean(error)}
          />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <Button className="submit-button" type="submit" size="lg" disabled={submitting}>
            {submitting ? '正在验证…' : '验证并查看方案'}
            <ArrowRight aria-hidden="true" />
          </Button>
          <p className="form-help">
            找不到访问码或访问码已到期？请联系为您制作方案的顾问。
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
