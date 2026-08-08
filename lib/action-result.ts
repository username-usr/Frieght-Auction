export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; field?: string }

// ExpectedActionError marks validation and business-rule failures that are
// safe to return to the browser. Unexpected database/auth errors are logged
// server-side and replaced with a generic message by actionFailure().
export class ExpectedActionError extends Error {
  field?: string

  constructor(message: string, field?: string) {
    super(message)
    this.name = 'ExpectedActionError'
    this.field = field
  }
}

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

export function actionFailure<T>(
  error: unknown,
  fallback: string,
  context: string
): ActionResult<T> {
  if (error instanceof ExpectedActionError) {
    return { ok: false, error: error.message, field: error.field }
  }

  console.error(`[${context}]`, error)
  return { ok: false, error: fallback }
}
