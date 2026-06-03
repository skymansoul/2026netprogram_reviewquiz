create table if not exists users (
  id integer primary key,
  login text not null,
  avatar_url text not null default '',
  html_url text not null default '',
  updated_at text not null
);

create table if not exists progress (
  user_id integer primary key,
  data text not null,
  updated_at text not null,
  foreign key (user_id) references users(id)
);
