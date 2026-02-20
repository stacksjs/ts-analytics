/**
 * Error utility tests
 * Covers JS regression + PHP-aware branches for all 5 utility functions
 */

import { describe, expect, it } from 'bun:test'
import {
  categorizeError,
  parseStackTrace,
  getErrorFingerprint,
  getErrorSeverity,
  shouldIgnoreError,
} from '../src/utils/errors'

// ============================================================================
// categorizeError
// ============================================================================

describe('categorizeError', () => {
  describe('JS regression — existing patterns still match without type/framework', () => {
    it('should categorize network errors', () => {
      expect(categorizeError('NetworkError when attempting to fetch resource')).toBe('Network')
      expect(categorizeError('Failed to fetch')).toBe('Network')
      expect(categorizeError('XHR failed')).toBe('Network')
    })

    it('should categorize syntax errors', () => {
      expect(categorizeError('SyntaxError: Unexpected token <')).toBe('Syntax')
      expect(categorizeError('Unexpected token in JSON')).toBe('Syntax')
    })

    it('should categorize type errors', () => {
      expect(categorizeError('TypeError: Cannot read properties of undefined')).toBe('Type')
      expect(categorizeError('foo is not a function')).toBe('Type')
    })

    it('should categorize reference errors', () => {
      expect(categorizeError('ReferenceError: x is not defined')).toBe('Reference')
    })

    it('should categorize range errors', () => {
      expect(categorizeError('RangeError: Maximum call stack size exceeded')).toBe('Range')
    })

    it('should categorize timeout errors', () => {
      expect(categorizeError('Request timed out')).toBe('Timeout')
    })

    it('should categorize CORS errors', () => {
      expect(categorizeError('CORS policy: No Access-Control-Allow-Origin')).toBe('CORS')
      expect(categorizeError('Cross-origin request blocked')).toBe('CORS')
    })

    it('should categorize security errors', () => {
      expect(categorizeError('SecurityError: blocked by CSP')).toBe('Security')
    })

    it('should categorize memory errors', () => {
      expect(categorizeError('Out of memory')).toBe('Memory')
    })

    it('should categorize third-party errors', () => {
      expect(categorizeError('Script error.')).toBe('Third-party')
    })

    it('should return Other for unknown', () => {
      expect(categorizeError('Something went wrong')).toBe('Other')
    })
  })

  describe('PHP type-based categorization', () => {
    it('should categorize PDOException as Database', () => {
      expect(categorizeError('Connection refused', 'PDOException', 'laravel')).toBe('Database')
    })

    it('should categorize QueryException as Database', () => {
      expect(categorizeError('SQLSTATE[42S02]', 'Illuminate\\Database\\QueryException', 'laravel')).toBe('Database')
    })

    it('should categorize AuthenticationException as Auth', () => {
      expect(categorizeError('Unauthenticated.', 'AuthenticationException', 'laravel')).toBe('Auth')
    })

    it('should categorize AuthorizationException as Auth', () => {
      expect(categorizeError('This action is unauthorized.', 'Illuminate\\Auth\\Access\\AuthorizationException', 'laravel')).toBe('Auth')
    })

    it('should categorize TokenMismatchException as Auth', () => {
      expect(categorizeError('CSRF token mismatch', 'TokenMismatchException', 'laravel')).toBe('Auth')
    })

    it('should categorize ValidationException as Validation', () => {
      expect(categorizeError('The given data was invalid.', 'ValidationException', 'laravel')).toBe('Validation')
    })

    it('should categorize NotFoundHttpException as HTTP 404', () => {
      expect(categorizeError('', 'Symfony\\Component\\HttpKernel\\Exception\\NotFoundHttpException', 'laravel')).toBe('HTTP 404')
    })

    it('should categorize MethodNotAllowedHttpException as HTTP', () => {
      expect(categorizeError('', 'MethodNotAllowedHttpException', 'laravel')).toBe('HTTP')
    })

    it('should categorize HttpException as HTTP', () => {
      expect(categorizeError('', 'HttpException', 'laravel')).toBe('HTTP')
    })

    it('should categorize TypeError as Type', () => {
      expect(categorizeError('Argument #1 must be of type string', 'TypeError', 'laravel')).toBe('Type')
    })

    it('should categorize RuntimeException as Runtime', () => {
      expect(categorizeError('Something failed', 'RuntimeException', 'laravel')).toBe('Runtime')
    })

    it('should categorize LogicException as Runtime', () => {
      expect(categorizeError('Logic error', 'LogicException', 'laravel')).toBe('Runtime')
    })

    it('should categorize ParseError as Syntax', () => {
      expect(categorizeError('syntax error, unexpected token', 'ParseError', 'laravel')).toBe('Syntax')
    })
  })

  describe('PHP message fallback', () => {
    it('should detect SQLSTATE as Database', () => {
      expect(categorizeError('SQLSTATE[HY000]: General error', undefined, 'laravel')).toBe('Database')
    })

    it('should detect PDO in message as Database', () => {
      expect(categorizeError('PDO connection failed', undefined, 'laravel')).toBe('Database')
    })

    it('should detect allowed memory size as Memory', () => {
      expect(categorizeError('Allowed memory size of 134217728 bytes exhausted', undefined, 'laravel')).toBe('Memory')
    })

    it('should detect maximum execution time as Timeout', () => {
      expect(categorizeError('Maximum execution time of 30 seconds exceeded', undefined, 'laravel')).toBe('Timeout')
    })

    it('should detect view errors as View', () => {
      expect(categorizeError('View [emails.welcome] not found.', undefined, 'laravel')).toBe('View')
      expect(categorizeError('Error compiling Blade template', undefined, 'laravel')).toBe('View')
    })

    it('should detect auth keywords as Auth', () => {
      expect(categorizeError('Unauthenticated.', undefined, 'laravel')).toBe('Auth')
      expect(categorizeError('Unauthorized access', undefined, 'laravel')).toBe('Auth')
      expect(categorizeError('Token mismatch detected', undefined, 'laravel')).toBe('Auth')
    })

    it('should detect 404 keywords as HTTP 404', () => {
      expect(categorizeError('Route not found', undefined, 'laravel')).toBe('HTTP 404')
      expect(categorizeError('404 page', undefined, 'laravel')).toBe('HTTP 404')
    })

    it('should return Other for unknown PHP errors', () => {
      expect(categorizeError('Something totally unknown', undefined, 'laravel')).toBe('Other')
    })
  })
})

// ============================================================================
// parseStackTrace
// ============================================================================

describe('parseStackTrace', () => {
  describe('JS regression — Chrome/Firefox', () => {
    it('should parse Chrome stack traces', () => {
      const stack = `Error: test
    at Object.handleClick (https://example.com/app.js:42:15)
    at HTMLButtonElement.onclick (https://example.com/app.js:100:3)`

      const frames = parseStackTrace(stack)
      expect(frames).toHaveLength(2)
      expect(frames[0].file).toBe('https://example.com/app.js')
      expect(frames[0].line).toBe(42)
      expect(frames[0].column).toBe(15)
      expect(frames[0].function).toBe('Object.handleClick')
    })

    it('should parse Firefox stack traces', () => {
      const stack = `handleClick@https://example.com/app.js:42:15
onclick@https://example.com/app.js:100:3`

      const frames = parseStackTrace(stack)
      expect(frames).toHaveLength(2)
      expect(frames[0].file).toBe('https://example.com/app.js')
      expect(frames[0].line).toBe(42)
      expect(frames[0].column).toBe(15)
      expect(frames[0].function).toBe('handleClick')
    })

    it('should return empty array for undefined stack', () => {
      expect(parseStackTrace(undefined)).toEqual([])
    })
  })

  describe('PHP stack traces', () => {
    it('should parse PHP stack frames', () => {
      const stack = `#0 /app/Http/Controllers/UserController.php(42): App\\Models\\User->find()
#1 /vendor/laravel/framework/src/Illuminate/Routing/Controller.php(54): App\\Http\\Controllers\\UserController->show()
#2 /vendor/laravel/framework/src/Illuminate/Routing/Route.php(238): call_user_func_array()`

      const frames = parseStackTrace(stack, 'laravel')
      expect(frames).toHaveLength(3)
      expect(frames[0].file).toBe('/app/Http/Controllers/UserController.php')
      expect(frames[0].line).toBe(42)
      expect(frames[0].column).toBe(0)
      expect(frames[0].function).toBe('App\\Models\\User->find()')
    })

    it('should skip {main} lines', () => {
      const stack = `#0 /app/routes/web.php(15): Closure->call()
#1 {main}`

      const frames = parseStackTrace(stack, 'laravel')
      expect(frames).toHaveLength(1)
      expect(frames[0].file).toBe('/app/routes/web.php')
    })

    it('should return empty array for empty stack', () => {
      expect(parseStackTrace('', 'laravel')).toEqual([])
    })
  })
})

// ============================================================================
// getErrorFingerprint
// ============================================================================

describe('getErrorFingerprint', () => {
  it('should produce fingerprint with file path for PHP errors', () => {
    const stack = '#0 /app/Http/Controllers/UserController.php(42): App\\Models\\User->find()'
    const fp = getErrorFingerprint('SQLSTATE[42S02]: Table not found', stack, 'laravel')

    expect(fp).toContain('/app/Http/Controllers/UserController.php:42')
    expect(fp).toContain('@')
  })

  it('should produce fingerprint with URL for JS errors', () => {
    const stack = '    at handleClick (https://example.com/app.js:42:15)'
    const fp = getErrorFingerprint('TypeError: Cannot read property', stack)

    expect(fp).toContain('https://example.com/app.js:42')
    expect(fp).toContain('@')
  })

  it('should use unknown when no stack provided', () => {
    const fp = getErrorFingerprint('some error', undefined)
    expect(fp).toContain('@unknown')
  })

  it('should normalize numbers in messages', () => {
    const fp = getErrorFingerprint('Error at line 42', undefined)
    expect(fp).toContain('line n')
    expect(fp).not.toContain('42')
  })
})

// ============================================================================
// getErrorSeverity
// ============================================================================

describe('getErrorSeverity', () => {
  describe('existing JS categories', () => {
    it('should return critical for Security', () => {
      expect(getErrorSeverity('Security', 1)).toBe('critical')
    })

    it('should return critical for Memory', () => {
      expect(getErrorSeverity('Memory', 1)).toBe('critical')
    })

    it('should return medium for Type at low count', () => {
      expect(getErrorSeverity('Type', 1)).toBe('medium')
    })

    it('should return high for Type at count > 10', () => {
      expect(getErrorSeverity('Type', 11)).toBe('high')
    })

    it('should return critical for Type at count > 100', () => {
      expect(getErrorSeverity('Type', 101)).toBe('critical')
    })

    it('should return medium for Network at low count', () => {
      expect(getErrorSeverity('Network', 1)).toBe('medium')
    })
  })

  describe('new PHP categories', () => {
    it('should return high for Database at low count', () => {
      expect(getErrorSeverity('Database', 1)).toBe('high')
    })

    it('should return high for Database at count > 10', () => {
      expect(getErrorSeverity('Database', 11)).toBe('high')
    })

    it('should return critical for Database at count > 100', () => {
      expect(getErrorSeverity('Database', 101)).toBe('critical')
    })

    it('should return medium for Auth at low count', () => {
      expect(getErrorSeverity('Auth', 1)).toBe('medium')
    })

    it('should return high for Auth at count > 10', () => {
      expect(getErrorSeverity('Auth', 11)).toBe('high')
    })

    it('should return critical for Auth at count > 100', () => {
      expect(getErrorSeverity('Auth', 101)).toBe('critical')
    })

    it('should return medium for Runtime at low count', () => {
      expect(getErrorSeverity('Runtime', 1)).toBe('medium')
    })

    it('should return medium for View at low count', () => {
      expect(getErrorSeverity('View', 1)).toBe('medium')
    })

    it('should return low for Validation at low count', () => {
      expect(getErrorSeverity('Validation', 1)).toBe('low')
    })

    it('should return medium for Validation at count > 100', () => {
      expect(getErrorSeverity('Validation', 101)).toBe('medium')
    })

    it('should return low for HTTP 404 at low count', () => {
      expect(getErrorSeverity('HTTP 404', 1)).toBe('low')
    })

    it('should return medium for HTTP 404 at count > 100', () => {
      expect(getErrorSeverity('HTTP 404', 101)).toBe('medium')
    })

    it('should return medium for HTTP at low count', () => {
      expect(getErrorSeverity('HTTP', 1)).toBe('medium')
    })
  })
})

// ============================================================================
// shouldIgnoreError
// ============================================================================

describe('shouldIgnoreError', () => {
  describe('JS regression', () => {
    it('should ignore Script error', () => {
      expect(shouldIgnoreError('Script error.')).toBe(true)
      expect(shouldIgnoreError('Script error')).toBe(true)
    })

    it('should ignore ResizeObserver loop', () => {
      expect(shouldIgnoreError('ResizeObserver loop limit exceeded')).toBe(true)
    })

    it('should ignore cancelled', () => {
      expect(shouldIgnoreError('Cancelled')).toBe(true)
    })

    it('should ignore loading chunk failed', () => {
      expect(shouldIgnoreError('Loading chunk 42 failed')).toBe(true)
    })

    it('should ignore network error', () => {
      expect(shouldIgnoreError('Network error')).toBe(true)
    })

    it('should ignore extension errors', () => {
      expect(shouldIgnoreError('Chrome extension error')).toBe(true)
    })

    it('should ignore null', () => {
      expect(shouldIgnoreError('null')).toBe(true)
    })

    it('should not ignore real errors', () => {
      expect(shouldIgnoreError('TypeError: Cannot read property')).toBe(false)
    })
  })

  describe('PHP patterns', () => {
    it('should ignore session store not set', () => {
      expect(shouldIgnoreError('Session store not set on request', 'laravel')).toBe(true)
    })

    it('should ignore deprecated messages', () => {
      expect(shouldIgnoreError('Deprecated: Function utf8_encode() is deprecated', 'laravel')).toBe(true)
    })

    it('should ignore deprecated function pattern', () => {
      expect(shouldIgnoreError('Using deprecated function str_contains', 'laravel')).toBe(true)
    })

    it('should ignore undefined array key', () => {
      expect(shouldIgnoreError('Undefined array key "foo"', 'laravel')).toBe(true)
    })

    it('should not ignore real PHP errors', () => {
      expect(shouldIgnoreError('SQLSTATE[42S02]: Table not found', 'laravel')).toBe(false)
    })
  })

  describe('isolation — PHP patterns do not fire in JS mode', () => {
    it('should not ignore PHP noise when framework is not set', () => {
      expect(shouldIgnoreError('Session store not set on request')).toBe(false)
      expect(shouldIgnoreError('Deprecated: some function')).toBe(false)
      expect(shouldIgnoreError('Undefined array key "bar"')).toBe(false)
    })

    it('should not ignore JS noise when framework is laravel', () => {
      expect(shouldIgnoreError('Script error.', 'laravel')).toBe(false)
      expect(shouldIgnoreError('ResizeObserver loop limit exceeded', 'laravel')).toBe(false)
      expect(shouldIgnoreError('null', 'laravel')).toBe(false)
    })
  })
})
