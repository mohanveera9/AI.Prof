import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsInt, Max, Min, ValidateNested } from "class-validator";

export class WorkingHourEntryDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  startMinute!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMinute!: number;
}

export class SetWorkingHoursDto {
  @IsArray()
  @ArrayMaxSize(7 * 4)
  @ValidateNested({ each: true })
  @Type(() => WorkingHourEntryDto)
  hours!: WorkingHourEntryDto[];
}
