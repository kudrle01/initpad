import { IsUUID } from 'class-validator';

export class RequestWorkloadDiagnosticDto {
  // Makes a browser retry idempotent without reusing or exposing an Agent
  // lease token.
  @IsUUID('4')
  requestId!: string;
}
