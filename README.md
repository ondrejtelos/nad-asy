# Nadcasova praca ucitelov

Webova aplikacia na evidenciu nadcasovej prace s prihlasovanim.

## Co aplikacia robi

- Kazdy ucitel ma vlastny e-mail a heslo.
- Podporovane typy uctov su Ucitel, THP zamestnanec a Administrator.
- Ucitel vidi a upravuje iba svoje zaznamy.
- Administrator vidi a upravuje vsetky zaznamy.
- Administrator pri vybranom ucitelovi vidi nadcasy spolu, cerpanie a zostavajuci zostatok.
- Administrator zapisuje, kolko hodin ucitel v danom mesiaci vycerpal.
- Ucitel vidi svoj celkovy pocet nadcasov, cerpanie a zostavajuci zostatok bez moznosti tieto udaje menit.
- Pri prvom prihlaseni si ucitel povinne zmeni docasne heslo.
- Ucitel moze poziadat o reset hesla a administrator mu nastavi nove docasne heslo.
- Administrator vytvara ucty ucitelov.
- Zadavanie je predvolene otvorene od 5. do 29. dna v mesiaci.
- Od 5. dna moze zamestnanec zadat lubovolny datum v aktivnom mesiaci, aj spatne od 1. dna alebo dopredu do konca mesiaca.
- Administrator moze zmenit termin a spustit novy mesiac.
- Administrator moze exportovat zaznamy do CSV.

## Lokalne vyskusanie

Dvakrat kliknite na `SPUSTIT_APLIKACIU.bat`.

Skusobne ucty:

```text
Administrator: adminzskysak / Kysak@210
Ucitel:        ucitel@skola.local / ucitel123
```

Lokalny rezim uklada data do `data.json`. Je urceny iba na skusanie.

## Online nasadenie

### 1. Supabase

1. Vytvorte projekt na https://supabase.com.
2. Otvorte `SQL Editor`.
3. Vlozte obsah suboru `supabase-setup.sql` a stlacte `Run`.
4. V `Project Settings > API` si poznacte:
   - Project URL
   - anon public key
   - service_role key

Service role kluc nikomu neposielajte a nedavajte ho do prehliadaca.

### 2. GitHub

1. Vytvorte sukromny repozitar.
2. Nahrajte do neho cely obsah tohto priecinka.

### 3. Render

1. Prihlaste sa na https://render.com cez GitHub.
2. Zvolte `New > Blueprint`.
3. Vyberte repozitar s aplikaciou.
4. Render nacita subor `render.yaml`.
5. Doplňte tri tajne premenne:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Spustite nasadenie.

Render vytvori verejnu adresu v tvare:

```text
https://nadcasy-ucitelov.onrender.com
```

### 4. Prvy administrator

1. V Supabase otvorte `Authentication > Users`.
2. Vytvorte prveho pouzivatela cez `Add user`.
3. V Supabase otvorte `SQL Editor` a spustite nasledujuci prikaz.
   E-mail a meno zmente za svoje:

```sql
update auth.users
set
  raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || '{"role":"admin"}'::jsonb,
  raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
    || '{"full_name":"Meno administratora"}'::jsonb
where email = 'admin@vasa-skola.sk';
```

4. Prihlaste sa tymto uctom do aplikacie.
5. Dalsie ucty uz vytvarajte priamo v casti `Administracia`.

## Bezpecnost

- `SUPABASE_SERVICE_ROLE_KEY` patri iba do tajnych premennych Renderu.
- Neposielajte ho e-mailom ani ho nevkladajte do verejneho GitHub repozitara.
- Pred pouzitim v skole zmente docasne hesla ucitelov.
