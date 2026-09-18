import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

@Controller()
export class AppController {
  @SkipThrottle()
  @Get("health")
  health() {
    return { status: "ok", service: "backend" };
  }
}
