import type { PersonaSpec } from "@ensemble/shared";

/**
 * Persona library. Persistence-agnostic interface so we can swap
 * between in-memory (tests) and sqlite (production default) without
 * changing the route handlers.
 *
 * v1 ships a tiny CRUD surface — no versioning, no soft delete.
 */
export interface IPersonaStore {
  list(): PersonaSpec[];
  get(id: string): PersonaSpec | undefined;
  put(spec: PersonaSpec): PersonaSpec;
  delete(id: string): boolean;
  count(): number;
}

export class InMemoryPersonaStore implements IPersonaStore {
  private readonly personas = new Map<string, PersonaSpec>();

  list(): PersonaSpec[] {
    return [...this.personas.values()];
  }

  get(id: string): PersonaSpec | undefined {
    return this.personas.get(id);
  }

  put(spec: PersonaSpec): PersonaSpec {
    this.personas.set(spec.id, spec);
    return spec;
  }

  delete(id: string): boolean {
    return this.personas.delete(id);
  }

  count(): number {
    return this.personas.size;
  }
}
