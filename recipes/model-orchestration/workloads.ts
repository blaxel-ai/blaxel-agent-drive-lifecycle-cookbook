export type WorkloadPlan = {
  workloadId: string;
  rationale: string;
};

export type WorkloadDefinition = {
  id: string;
  description: string;
  command: string;
  allowedDomains: string[];
  credentialDestination?: string;
};

export class WorkloadRegistry {
  private readonly workloads: Map<string, WorkloadDefinition>;

  constructor(definitions: WorkloadDefinition[]) {
    this.workloads = new Map(
      definitions.map((definition) => [definition.id, definition]),
    );
    if (this.workloads.size !== definitions.length) {
      throw new Error("Workload IDs must be unique");
    }
  }

  list(): Array<Pick<WorkloadDefinition, "id" | "description">> {
    return [...this.workloads.values()].map(({ id, description }) => ({
      id,
      description,
    }));
  }

  resolve(plan: WorkloadPlan): WorkloadDefinition {
    const workload = this.workloads.get(plan.workloadId);
    if (!workload) {
      throw new Error(`Model selected unknown workload: ${plan.workloadId}`);
    }
    return workload;
  }
}
