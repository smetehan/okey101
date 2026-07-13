-- ─────────────────────────────────────────────────────────────
-- 101 Okey — Supabase şeması (Supabase SQL Editor'de çalıştırın)
-- Tek masa: her iki tabloda da id=1 satırı kullanılır.
-- ─────────────────────────────────────────────────────────────

-- HERKESİN GÖREBİLECEĞİ durum (realtime bu tablodan yayınlanır)
create table if not exists game_public (
  id            int primary key default 1 check (id = 1),
  faz           text not null default 'lobi',      -- lobi | oyun | el_sonu
  oyuncular     jsonb not null default '[]',        -- [{koltuk, ad, bagli}]
  sira          int,                                -- sıradaki koltuk 0..3
  cekti         boolean not null default false,     -- sıradaki taş çekti mi
  baslayan      int,
  gosterge      jsonb,                              -- Tas
  okey          jsonb,                              -- {renk, sayi}
  yigin_sayisi  int not null default 0,
  el_sayilari   jsonb not null default '[0,0,0,0]', -- her oyuncunun taş adedi
  atilanlar     jsonb not null default '[[],[],[],[]]', -- koltuk bazlı atılan taşlar
  acilan_perler jsonb not null default '[]',        -- [{koltuk, taslar:[Tas[]], tip}]
  acanlar       jsonb not null default '[false,false,false,false]',
  skorlar       jsonb not null default '[0,0,0,0]',
  el_no         int not null default 0,
  son_olay      jsonb,                              -- {tip, koltuk, mesaj, ts}
  updated_at    timestamptz not null default now()
);

-- SADECE SUNUCUNUN görebileceği durum (eller, yığın, tokenlar)
create table if not exists game_private (
  id       int primary key default 1 check (id = 1),
  yigin    jsonb not null default '[]',   -- Tas[]
  eller    jsonb not null default '[[],[],[],[]]',
  tokenlar jsonb not null default '{}'    -- {"0": "uuid", ...}
);

insert into game_public (id) values (1) on conflict do nothing;
insert into game_private (id) values (1) on conflict do nothing;

-- RLS
alter table game_public  enable row level security;
alter table game_private enable row level security;

-- public tabloyu herkes OKUYABİLİR (yazma sadece service role)
drop policy if exists "public okunur" on game_public;
create policy "public okunur" on game_public for select using (true);

-- private tabloya anon/authenticated HİÇ erişemez (policy yok = kapalı;
-- service role RLS'i zaten atlar)

-- Realtime yayını
alter publication supabase_realtime add table game_public;

-- updated_at tetikleyicisi
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_updated on game_public;
create trigger trg_updated before update on game_public
  for each row execute function set_updated_at();
