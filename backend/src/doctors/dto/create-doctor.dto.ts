import { ArrayNotEmpty, IsArray, IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

export class CreateDoctorDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsArray()
  specialtyIds?: string[];

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
  @ArrayNotEmpty()
  consultationTypes?: string[];

  @IsOptional()
  @IsInt()
  @Min(5)
  defaultAppointmentDurationMinutes?: number;

  @IsOptional()
  @IsString()
  externalProviderId?: string;
}
