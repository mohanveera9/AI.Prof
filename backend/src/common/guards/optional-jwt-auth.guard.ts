import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/** Attaches req.user when a Bearer token is present; otherwise continues anonymously. */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  override canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    if (!req.headers.authorization) return true;
    return super.canActivate(context);
  }

  override handleRequest<TUser>(err: Error | null, user: TUser): TUser | undefined {
    if (err || !user) return undefined;
    return user;
  }
}
