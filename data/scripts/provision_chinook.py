#!/usr/bin/env python3
"""Provision only the pinned Chinook source in a new, isolated local database.
No arbitrary SQL input, no DROP DATABASE, no password on the process command line.
"""
import argparse, hashlib, json, os, re, secrets, subprocess, sys, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SOURCE=json.loads((ROOT/'data/chinook/source.json').read_text())
CACHE=ROOT/'data/downloads/chinook'
STATE=ROOT/'.local';STATE.mkdir(exist_ok=True,mode=0o700)

def command(argv,sql=None,env=None):
    p=subprocess.run(argv,input=sql,text=True,capture_output=True,env=env)
    if p.returncode: raise RuntimeError('Database command failed. Check local service/access. No credentials or raw SQL are printed.')
    return p.stdout.strip()

def pg(sql,db='postgres',env=None):
    return command(['psql','-X','-q','-v','ON_ERROR_STOP=1','-d',db,'-At'],sql,env)

def literal(s): return "'"+s.replace("'","''")+"'"
def ident(s):
    if not re.fullmatch('[a-z][a-z0-9_]{0,50}',s):raise ValueError('Unsafe database/role identifier')
    return '"'+s+'"'

def download(engine):
    f=SOURCE['files'][engine];CACHE.mkdir(parents=True,exist_ok=True);path=CACHE/f['name']
    if not path.exists():
        url=f"https://github.com/lerocha/chinook-database/releases/download/{SOURCE['release']}/{f['name']}"
        with urllib.request.urlopen(url,timeout=60) as response:path.write_bytes(response.read())
    if hashlib.sha256(path.read_bytes()).hexdigest()!=f['sha256']:raise ValueError('Upstream checksum mismatch; refusing execution')
    return path.read_text(encoding='utf-8-sig')

def payload(engine,text):
    # Exact source hash is checked first. Strip the known upstream database preamble,
    # not arbitrary SQL. The server/client connection selects the isolated target.
    marker={'POSTGRESQL':'CREATE TABLE album','MYSQL':'CREATE TABLE `Album`','SQL_SERVER':'CREATE TABLE [dbo].[Album]'}[engine]
    start=text.find(marker)
    if start<0:raise ValueError('Pinned upstream table marker missing')
    sql=text[start:]
    if re.search(r'(?im)^\s*(DROP\s+DATABASE|CREATE\s+DATABASE|USE\s|\\c\b|ALTER\s+DATABASE)',sql):raise ValueError('Unexpected database-level statement in payload')
    return sql

def verify_pg(db,reader_env=None):
    counts={}
    for name,expected in SOURCE['expectedCounts'].items():
        n=int(pg(f'SELECT count(*) FROM public.{ident(name)}',db,reader_env));counts[name]=n
        if n!=expected:raise ValueError(f'Unexpected row count for {name}: {n} != {expected}')
    fk=int(pg("SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public'",db))
    if fk!=11:raise ValueError(f'Unexpected foreign key count: {fk}')
    return counts

def postgres(verify_only):
    db='nla_chinook';meta='nla_metadata';reader='nla_chinook_reader';app='nla_app'
    state=STATE/'database.env'
    if state.exists():
        # Repeated invocation verifies without resetting user data or rotating secrets.
        if not pg("SELECT 1 FROM pg_database WHERE datname='nla_chinook'"):raise RuntimeError('Saved state exists but database missing; inspect manually')
        counts=verify_pg(db)
        print(json.dumps({'status':'VERIFIED_EXISTING','database':db,'counts':counts}));return
    if verify_only:raise RuntimeError('Provisioning state missing')
    for name in [db,meta]:
        if pg('SELECT 1 FROM pg_database WHERE datname='+literal(name)):raise RuntimeError(f'Refusing to overwrite existing database {name}')
    for name in [reader,app]:
        if pg('SELECT 1 FROM pg_roles WHERE rolname='+literal(name)):raise RuntimeError(f'Refusing to modify existing role {name}')
    reader_password=secrets.token_urlsafe(32);app_password=secrets.token_urlsafe(32)
    sql=payload('POSTGRESQL',download('POSTGRESQL'))
    pg(f'CREATE ROLE {ident(reader)} LOGIN PASSWORD {literal(reader_password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; CREATE ROLE {ident(app)} LOGIN PASSWORD {literal(app_password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;')
    pg(f'CREATE DATABASE {ident(db)};');pg(f'CREATE DATABASE {ident(meta)} OWNER {ident(app)};')
    pg(sql,db)
    pg(f'REVOKE ALL ON DATABASE {ident(db)} FROM PUBLIC; GRANT CONNECT ON DATABASE {ident(db)} TO {ident(reader)};')
    pg(f'REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO {ident(reader)}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO {ident(reader)}; ALTER ROLE {ident(reader)} SET default_transaction_read_only = on; ALTER ROLE {ident(reader)} SET statement_timeout = \'15s\';',db)
    env=dict(os.environ,PGHOST='127.0.0.1',PGPORT='5432',PGUSER=reader,PGPASSWORD=reader_password)
    counts=verify_pg(db,env)
    # Independently check grants: read-only transactions alone are not the boundary.
    grants=pg("SELECT has_table_privilege(current_user,'public.track','INSERT') OR has_table_privilege(current_user,'public.track','UPDATE') OR has_table_privilege(current_user,'public.track','DELETE')",db,env)
    if grants!='f':raise RuntimeError('Reader has unexpected write privilege')
    state.write_text('\n'.join([f'METADATA_JDBC_URL=jdbc:postgresql://127.0.0.1:5432/{meta}',f'METADATA_USERNAME={app}',f'METADATA_PASSWORD={app_password}',f'NLA_CHINOOK_PG_PASSWORD={reader_password}','WAREHOUSE_ALLOWED_HOSTS=127.0.0.1,localhost','SPRING_PROFILES_ACTIVE=local'])+'\n');state.chmod(0o600)
    report={'release':SOURCE['release'],'sha256':SOURCE['files']['POSTGRESQL']['sha256'],'database':db,'engine':'POSTGRESQL','counts':counts,'foreignKeys':11,'readerWritePrivileges':False}
    (STATE/'chinook-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':'IMPORTED_VERIFIED','database':db,'counts':counts,'foreignKeys':11,'readerWritePrivileges':False}))

def native(engine,verify_only):
    # Credentials must be supplied through standard native-client environment.
    # These adapters never modify the upstream Chinook database.
    db='nla_chinook';sql=payload(engine,download(engine))
    if engine=='MYSQL':
        argv=['mysql','--batch','--skip-column-names','--host',os.environ.get('MYSQL_HOST','127.0.0.1'),'--port',os.environ.get('MYSQL_PORT','3306'),'--user',os.environ.get('MYSQL_USER','root')]
        exists=command(argv,'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=\'nla_chinook\';')
        if exists and not verify_only:raise RuntimeError('Refusing to overwrite existing nla_chinook; use --verify-only')
        if not verify_only:command(argv,'CREATE DATABASE `nla_chinook` CHARACTER SET utf8mb4;');command(argv+[db],sql)
        canonical={'invoice_line':'InvoiceLine','media_type':'MediaType','playlist_track':'PlaylistTrack'}
        for name,expected in SOURCE['expectedCounts'].items():
            physical=canonical.get(name,name.title());n=int(command(argv+[db],f'SELECT COUNT(*) FROM `{physical}`;'))
            if n!=expected:raise ValueError(f'Count mismatch: {physical}')
    else:
        argv=['sqlcmd','-b','-S',os.environ.get('MSSQL_SERVER','127.0.0.1,1433'),'-U',os.environ.get('MSSQL_USER','sa'),'-h','-1','-W']
        exists=command(argv,['SELECT DB_ID(\'nla_chinook\');'][0])
        if exists!='NULL' and not verify_only:raise RuntimeError('Refusing to overwrite existing nla_chinook; use --verify-only')
        if not verify_only:command(argv,'CREATE DATABASE [nla_chinook];\nGO\n');command(argv+['-d',db],sql)
        canonical={'invoice_line':'InvoiceLine','media_type':'MediaType','playlist_track':'PlaylistTrack'}
        for name,expected in SOURCE['expectedCounts'].items():
            physical=canonical.get(name,name.title());out=command(argv+['-d',db],f'SET NOCOUNT ON; SELECT COUNT(*) FROM [dbo].[{physical}];\nGO\n')
            if int(out)!=expected:raise ValueError(f'Count mismatch: {physical}')
    print(json.dumps({'status':'VERIFIED','engine':engine,'database':db,'tables':11}))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--engine',choices=SOURCE['files'],default='POSTGRESQL');parser.add_argument('--verify-only',action='store_true');parser.add_argument('--download-only',action='store_true');args=parser.parse_args()
    if args.download_only:download(args.engine);print('Pinned source downloaded and checksum verified.');return
    if args.engine=='POSTGRESQL':postgres(args.verify_only)
    else:native(args.engine,args.verify_only)
if __name__=='__main__':
    try:main()
    except Exception as error:print(str(error),file=sys.stderr);sys.exit(1)
