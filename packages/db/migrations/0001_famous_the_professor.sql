CREATE TYPE "public"."engine_event_type" AS ENUM('ignition_on', 'ignition_off', 'movement_start', 'movement_stop');--> statement-breakpoint
CREATE TYPE "public"."fuel_source" AS ENUM('can_pct', 'can_liters', 'obd_pct', 'lls1', 'lls2');--> statement-breakpoint
CREATE TYPE "public"."vehicle_alert_type" AS ENUM('low_fuel', 'geofence_exit', 'speeding');--> statement-breakpoint
CREATE TABLE "geofences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "geofences_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"center_latitude" double precision NOT NULL,
	"center_longitude" double precision NOT NULL,
	"radius_m" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geofences_radius_positive" CHECK ("geofences"."radius_m" > 0),
	CONSTRAINT "geofences_center_in_range" CHECK ("geofences"."center_latitude" between -90 and 90 and "geofences"."center_longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "vehicle_alert_states" (
	"vehicle_id" uuid NOT NULL,
	"alert_type" "vehicle_alert_type" NOT NULL,
	"active" boolean NOT NULL,
	"last_fired_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_alert_states_vehicle_id_alert_type_pk" PRIMARY KEY("vehicle_id","alert_type")
);
--> statement-breakpoint
CREATE TABLE "vehicle_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "vehicle_alerts_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vehicle_id" uuid NOT NULL,
	"alert_type" "vehicle_alert_type" NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_engine_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"event_type" "engine_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_fuel_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"source" "fuel_source" NOT NULL,
	"level_pct" integer,
	"level_liters" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_fuel_readings_has_a_value" CHECK ("vehicle_fuel_readings"."level_pct" is not null or "vehicle_fuel_readings"."level_liters" is not null),
	CONSTRAINT "vehicle_fuel_readings_pct_in_range" CHECK ("vehicle_fuel_readings"."level_pct" is null or "vehicle_fuel_readings"."level_pct" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "vehicle_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"altitude_m" integer NOT NULL,
	"angle_deg" integer NOT NULL,
	"satellites" smallint NOT NULL,
	"speed_kph" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_locations_coordinates_in_range" CHECK ("vehicle_locations"."latitude" between -90 and 90 and "vehicle_locations"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "vehicles_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"imei" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_imei_digits" CHECK ("vehicles"."imei" ~ '^[0-9]{15}$')
);
--> statement-breakpoint
ALTER TABLE "vehicle_alert_states" ADD CONSTRAINT "vehicle_alert_states_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_alerts" ADD CONSTRAINT "vehicle_alerts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_engine_events" ADD CONSTRAINT "vehicle_engine_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_fuel_readings" ADD CONSTRAINT "vehicle_fuel_readings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_locations" ADD CONSTRAINT "vehicle_locations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "geofences_active_idx" ON "geofences" USING btree ("active");--> statement-breakpoint
CREATE INDEX "vehicle_alerts_vehicle_seq_idx" ON "vehicle_alerts" USING btree ("vehicle_id","seq");--> statement-breakpoint
CREATE INDEX "vehicle_alerts_type_seq_idx" ON "vehicle_alerts" USING btree ("alert_type","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_engine_events_dedup_uq" ON "vehicle_engine_events" USING btree ("vehicle_id","recorded_at","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_fuel_readings_dedup_uq" ON "vehicle_fuel_readings" USING btree ("vehicle_id","recorded_at","source");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_locations_dedup_uq" ON "vehicle_locations" USING btree ("vehicle_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_imei_uq" ON "vehicles" USING btree ("imei");