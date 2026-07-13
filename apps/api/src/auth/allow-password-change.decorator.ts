import { SetMetadata } from '@nestjs/common';

// Marks the few endpoints that stay reachable while an account is under a
// forced password change (admin-provisioned temporary credentials, post-reset).
// Everything else is blocked by JwtAuthGuard until the password is changed.
export const ALLOW_PASSWORD_CHANGE = 'allowDuringPasswordChange';
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);
