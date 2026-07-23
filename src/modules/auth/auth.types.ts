export type UserSegment = 'b2c' | 'b2b';

export type ApprovalJwt =
  | 'pending'
  | 'approved'
  | 'rejected'
  | null;

export interface JwtPayload {
  sub: string;
  email: string;
  segment: UserSegment;
  approvalStatus: ApprovalJwt;
}
