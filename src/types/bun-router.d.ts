declare module '@stacksjs/bun-router' {
  export class Router {
    constructor(options?: any)
    get(path: string, handler: any): Promise<any>
    post(path: string, handler: any): Promise<any>
    put(path: string, handler: any): Promise<any>
    delete(path: string, handler: any): Promise<any>
    patch(path: string, handler: any): Promise<any>
    start(options?: any): Promise<any>
    handleRequest(request: Request): Promise<Response>
    [key: string]: any
  }

  export function injectQueryPreservationScript(html: string, config: any): string
}
