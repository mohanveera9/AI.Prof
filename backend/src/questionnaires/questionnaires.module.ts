import { Module } from "@nestjs/common";
import { QuestionnairesService } from "./questionnaires.service";
import { QuestionnairesController } from "./questionnaires.controller";

@Module({
  providers: [QuestionnairesService],
  controllers: [QuestionnairesController],
  exports: [QuestionnairesService],
})
export class QuestionnairesModule {}
