declare module '@stacksjs/stx' {
  export function processDirectives(
    _template: string,
    _context: Record<string, unknown>,
    _templatePath: string,
    _config: any,
    _seen: Set<string>,
  ): Promise<string>

  export function extractVariables(
    _script: string,
    _context: Record<string, unknown>,
    _templatePath: string,
  ): Promise<void>

  export function buildViews(_options?: any): Promise<void>

  export const defaultConfig: Record<string, any>

  export function createRoute(
    _handler: (request: Request) => Response | Promise<Response>,
  ): (request: Request) => Response | Promise<Response>

  export function createMiddleware(_options?: any): any

  export function readMarkdownFile(_path: string): any
}
