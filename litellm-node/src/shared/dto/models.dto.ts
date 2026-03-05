export class ModelObject {
  id!: string;
  object!: string;
  created!: number;
  owned_by!: string;
}

export class ModelListResponse {
  object!: string;
  data!: ModelObject[];
}
