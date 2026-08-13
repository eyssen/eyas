import type { EyasModule, ModuleContext } from './types.js'

export class ModuleLoader {
  private modules = new Map<string, EyasModule>()

  register(mod: EyasModule): void {
    if (this.modules.has(mod.id)) {
      throw new Error(`Module "${mod.id}" is already registered`)
    }
    this.modules.set(mod.id, mod)
  }

  hasModule(id: string): boolean {
    return this.modules.has(id)
  }

  getModule<T extends EyasModule>(id: string): T {
    const mod = this.modules.get(id)
    if (!mod) throw new Error(`Module "${id}" not found`)
    return mod as T
  }

  getActiveModules(disabled: string[]): EyasModule[] {
    const disabledSet = new Set(disabled)
    return Array.from(this.modules.values()).filter((m) => !disabledSet.has(m.id))
  }

  resolveDependencies(): string[] {
    const resolved: string[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (id: string) => {
      if (visited.has(id)) return
      if (visiting.has(id)) throw new Error(`Circular dependency detected: ${id}`)
      visiting.add(id)
      const mod = this.modules.get(id)
      if (mod) {
        for (const dep of mod.dependencies) visit(dep)
      }
      visiting.delete(id)
      visited.add(id)
      resolved.push(id)
    }

    for (const id of this.modules.keys()) visit(id)
    return resolved
  }

  async startAll(ctx: ModuleContext, disabled: string[]): Promise<void> {
    const order = this.resolveDependencies()
    const disabledSet = new Set(disabled)
    for (const id of order) {
      if (disabledSet.has(id)) continue
      const mod = this.modules.get(id)!
      await mod.onRegister(ctx)
    }
    for (const id of order) {
      if (disabledSet.has(id)) continue
      const mod = this.modules.get(id)!
      await mod.onStart(ctx)
    }
  }

  async stopAll(ctx: ModuleContext): Promise<void> {
    const order = this.resolveDependencies().reverse()
    for (const id of order) {
      const mod = this.modules.get(id)
      if (mod) await mod.onStop(ctx)
    }
  }
}
