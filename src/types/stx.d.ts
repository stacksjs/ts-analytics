declare module '@stacksjs/stx' {
  export function processDirectives(
    template: string,
    context: Record<string, unknown>,
    templatePath: string,
    config: any,
    seen: Set<string>,
  ): Promise<string>

  export function extractVariables(
    script: string,
    context: Record<string, unknown>,
    templatePath: string,
  ): Promise<void>

  export function buildViews(options?: any): Promise<void>

  export const defaultConfig: Record<string, any>
}
