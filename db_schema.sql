-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Table Students
create table students (
  id uuid default uuid_generate_v4() primary key,
  device_id uuid not null unique,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Table Feedbacks
create table feedbacks (
  id uuid default uuid_generate_v4() primary key,
  student_id uuid references students(id) not null,
  subject text not null,
  q1 int,
  q2 int,
  q3 int,
  q4 int,
  q5 int,
  q6_jobs text,
  q7_rooms int,
  q8_resources int,
  q9_transport text,
  q10_laptop text,
  comments text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Index for faster lookups
create index idx_feedbacks_student on feedbacks(student_id);
