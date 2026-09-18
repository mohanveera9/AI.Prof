import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class RegisterHospitalDto {
  @IsString()
  hospitalName!: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsEmail()
  contactEmail!: string;

  @IsString()
  adminName!: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(8)
  adminPassword!: string;
}
