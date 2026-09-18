import { IsArray, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpdateDoctorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  qualifications?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  experienceYears?: number;

  @IsOptional()
  @IsArray()
  languages?: string[];

  @IsOptional()
  @IsArray()
  consultationTypes?: string[];

  @IsOptional()
  @IsInt()
  @Min(5)
  defaultAppointmentDurationMinutes?: number;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsArray()
  specialtyIds?: string[];
}
