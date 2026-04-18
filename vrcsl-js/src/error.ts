/** Custom error class for all VRCSL SDK errors. */
export class VRCSLError extends Error {
  /** Machine-readable error code. */
  code: string;

  /** HTTP status code (if applicable). null for transport/SDK errors. */
  status: number | null;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "VRCSLError";
    this.code = code;
    this.status = status ?? null;
  }
}
