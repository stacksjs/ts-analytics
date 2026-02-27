declare module '@stacksjs/bun-router' {
  export class Router {
    constructor(_options?: any)
    get(_path: string, _handler: any): Promise<any>
    post(_path: string, _handler: any): Promise<any>
    put(_path: string, _handler: any): Promise<any>
    delete(_path: string, _handler: any): Promise<any>
    patch(_path: string, _handler: any): Promise<any>
    start(_options?: any): Promise<any>
    handleRequest(_request: Request): Promise<Response>
    [key: string]: any
  }

  export function injectQueryPreservationScript(_html: string, _config: any): string
}
