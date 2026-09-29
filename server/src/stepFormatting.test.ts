import test from 'node:test';
import assert from 'node:assert/strict';

function sanitizeStepError(rawError: unknown, cleanOut: string, isErr: boolean): string | undefined {
  if (typeof rawError === 'string') {
    return rawError;
  } else if (rawError && typeof rawError === 'object') {
    return (rawError as any).message || JSON.stringify(rawError, null, 2);
  } else if (typeof rawError === 'boolean' && rawError) {
    return cleanOut ? undefined : 'Tool execution failed';
  } else if (isErr && !cleanOut) {
    return 'Tool execution failed';
  }
  return undefined;
}

function normalizeStepOutput(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'boolean') return '';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    if ('message' in (val as any) && typeof (val as any).message === 'string') {
      return (val as any).message;
    }
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

test('sanitizeStepError properly converts boolean error to string or undefined', () => {
  // When rawError is boolean true and there is output
  const resWithOut = sanitizeStepError(true, 'File not found on disk', true);
  assert.equal(resWithOut, undefined);

  // When rawError is boolean true and there is no output
  const resWithoutOut = sanitizeStepError(true, '', true);
  assert.equal(resWithoutOut, 'Tool execution failed');
});

test('sanitizeStepError handles object errors correctly', () => {
  const errObj = { message: 'Failed to write file' };
  const res = sanitizeStepError(errObj, '', true);
  assert.equal(res, 'Failed to write file');

  const errObjNoMsg = { code: 500, detail: 'Crash' };
  const resNoMsg = sanitizeStepError(errObjNoMsg, '', true);
  assert.ok(resNoMsg?.includes('"code": 500'));
});

test('normalizeStepOutput handles any non-string type without throwing', () => {
  assert.equal(normalizeStepOutput(true), '');
  assert.equal(normalizeStepOutput(false), '');
  assert.equal(normalizeStepOutput(undefined), '');
  assert.equal(normalizeStepOutput(null), '');
  assert.equal(normalizeStepOutput(123), '123');
  assert.equal(normalizeStepOutput({ message: 'Error text' }), 'Error text');
  assert.equal(normalizeStepOutput({ detail: 'Info' }), '{\n  "detail": "Info"\n}');
  assert.equal(normalizeStepOutput('Already string\nline 2'), 'Already string\nline 2');

  // Verify .split('\n') never throws on normalized output
  const lines = normalizeStepOutput(true).split('\n');
  assert.deepEqual(lines, ['']);
});
