declare module 'bun-router' {
  export class Router {
    constructor(options?: Record<string, unknown>)
    get(path: string, handler: (req: any) => any): Promise<void>
    post(path: string, handler: (req: any) => any): Promise<void>
    put(path: string, handler: (req: any) => any): Promise<void>
    delete(path: string, handler: (req: any) => any): Promise<void>
    use(middleware: any): Promise<void>
    serve(options: { port: number }): Promise<void>
    handleRequest(request: Request): Promise<Response>
  }

  export function cors(options?: Record<string, unknown>): any
  export function injectQueryPreservationScript(html: string, config: Record<string, unknown>): string
}
