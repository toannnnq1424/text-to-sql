#!/usr/bin/env python3
"""Pinned native Chinook provisioning inside isolated Compose databases."""
import argparse, json, os, secrets, subprocess, sys, time
from pathlib import Path
from provision_chinook import ROOT,SOURCE,download,payload,literal,ident
LOCAL=ROOT/'.local';CONFIG=LOCAL/'compose.env';RUNTIME=LOCAL/'docker.env'

def init():
    LOCAL.mkdir(exist_ok=True,mode=0o700)
    if not CONFIG.exists():
        values={key:'Nla_'+secrets.token_urlsafe(27)+'9!' for key in ['NLA_PG_ADMIN_PASSWORD','NLA_MYSQL_ADMIN_PASSWORD','NLA_MSSQL_ADMIN_PASSWORD','NLA_CHINOOK_PG_PASSWORD','NLA_CHINOOK_MYSQL_PASSWORD','NLA_CHINOOK_MSSQL_PASSWORD','METADATA_PASSWORD','LOCAL_API_TOKEN']}
        CONFIG.write_text(''.join(f'{k}={v}\n' for k,v in values.items()));CONFIG.chmod(0o600)
    return dict(line.split('=',1) for line in CONFIG.read_text().splitlines() if line and not line.startswith('#'))

def compose(*args,sql=None,check=True):
    p=subprocess.run(['docker','compose','--env-file',str(CONFIG),'-f',str(ROOT/'infra/compose.databases.yml'),*args],input=sql,text=True,capture_output=True)
    if p.returncode and check:raise RuntimeError('Docker database command failed; inspect service health. No credentials or SQL printed.')
    return p

def execute(engine,sql,db=None,reader=False):
    vals=init()
    if engine=='POSTGRESQL':
        user='nla_reader' if reader else 'nla_provisioner';password=vals['NLA_CHINOOK_PG_PASSWORD' if reader else 'NLA_PG_ADMIN_PASSWORD']
        args=['exec','-T','-e','PGPASSWORD','postgres','psql','-X','-q','-v','ON_ERROR_STOP=1','-U',user,'-d',db or 'postgres','-At'];env=dict(os.environ,PGPASSWORD=password)
    elif engine=='MYSQL':
        user='nla_reader' if reader else 'root';password=vals['NLA_CHINOOK_MYSQL_PASSWORD' if reader else 'NLA_MYSQL_ADMIN_PASSWORD']
        args=['exec','-T','-e','MYSQL_PWD','mysql','mysql','--batch','--skip-column-names','-u',user]+([db] if db else []);env=dict(os.environ,MYSQL_PWD=password)
    else:
        user='nla_reader' if reader else 'sa';password=vals['NLA_CHINOOK_MSSQL_PASSWORD' if reader else 'NLA_MSSQL_ADMIN_PASSWORD']
        args=['exec','-T','-e','SQLCMDPASSWORD','sqlserver','/opt/mssql-tools18/bin/sqlcmd','-S','localhost','-U',user,'-C','-b','-h','-1','-W']+(['-d',db] if db else []);env=dict(os.environ,SQLCMDPASSWORD=password)
    p=subprocess.run(['docker','compose','--env-file',str(CONFIG),'-f',str(ROOT/'infra/compose.databases.yml'),*args],input=sql,text=True,capture_output=True,env=env)
    if p.returncode:raise RuntimeError(f'{engine} database command failed; inspect service/access. Credentials and raw SQL suppressed.')
    return p.stdout.strip()

def provision(engine):
    vals=init();marker=LOCAL/f'chinook-{engine}.json';db='nla_chinook'
    if not marker.exists():
        check={'POSTGRESQL':"SELECT count(*) FROM pg_database WHERE datname='nla_chinook';",'MYSQL':"SELECT count(*) FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='nla_chinook';",'SQL_SERVER':"SET NOCOUNT ON; SELECT count(*) FROM sys.databases WHERE name='nla_chinook';\nGO\n"}[engine]
        if int(execute(engine,check))!=0:raise RuntimeError(f'Refusing to overwrite existing {engine} database without provenance marker.')
        native=payload(engine,download(engine))
        if engine=='POSTGRESQL':
            execute(engine,'CREATE DATABASE nla_chinook;');execute(engine,native,db)
            execute(engine,f"CREATE ROLE nla_reader LOGIN PASSWORD {literal(vals['NLA_CHINOOK_PG_PASSWORD'])} NOSUPERUSER NOCREATEDB NOCREATEROLE; CREATE ROLE nla_app LOGIN PASSWORD {literal(vals['METADATA_PASSWORD'])} NOSUPERUSER NOCREATEDB NOCREATEROLE;")
            execute(engine,'CREATE DATABASE nla_metadata OWNER nla_app;')
            execute(engine,'REVOKE ALL ON DATABASE nla_chinook FROM PUBLIC; GRANT CONNECT ON DATABASE nla_chinook TO nla_reader;')
            execute(engine,"REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO nla_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO nla_reader; ALTER ROLE nla_reader SET default_transaction_read_only=on; ALTER ROLE nla_reader SET statement_timeout='15s';",db)
        elif engine=='MYSQL':
            execute(engine,'CREATE DATABASE `nla_chinook` CHARACTER SET utf8mb4;');execute(engine,native,db)
            execute(engine,f"CREATE USER 'nla_reader'@'%' IDENTIFIED BY {literal(vals['NLA_CHINOOK_MYSQL_PASSWORD'])}; GRANT SELECT, SHOW VIEW ON nla_chinook.* TO 'nla_reader'@'%';")
        else:
            execute(engine,'CREATE DATABASE [nla_chinook];\nGO\n');execute(engine,native,db)
            execute(engine,f"CREATE LOGIN [nla_reader] WITH PASSWORD={literal(vals['NLA_CHINOOK_MSSQL_PASSWORD'])}, CHECK_POLICY=ON;\nGO\n")
            execute(engine,"CREATE USER [nla_reader] FOR LOGIN [nla_reader]; GRANT SELECT TO [nla_reader]; GRANT VIEW DEFINITION TO [nla_reader]; DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER TO [nla_reader];\nGO\n",db)
        # Persist provenance before verification so a failed verification can be retried without destructive re-import.
        marker.write_text(json.dumps({'engine':engine,'release':SOURCE['release'],'status':'IMPORTED_UNVERIFIED'},indent=2)+'\n')
    counts={};names={'invoice_line':'InvoiceLine','media_type':'MediaType','playlist_track':'PlaylistTrack'}
    for canonical,expected in SOURCE['expectedCounts'].items():
        name=canonical if engine=='POSTGRESQL' else names.get(canonical,canonical.title())
        quote='"'+name+'"' if engine=='POSTGRESQL' else '`'+name+'`' if engine=='MYSQL' else '[dbo].['+name+']'
        query=f'SELECT COUNT(*) FROM {quote};'
        if engine=='SQL_SERVER':query='SET NOCOUNT ON; '+query+'\nGO\n'
        n=int(execute(engine,query,db,reader=True));counts[canonical]=n
        if n!=expected:raise RuntimeError(f'{engine}: row count mismatch for {canonical}: {n} != {expected}')
    # Test writes with a no-op update; no sample data can be changed even if privileges are wrong.
    name='track' if engine=='POSTGRESQL' else 'Track';col='name' if engine=='POSTGRESQL' else 'Name'
    write=f'UPDATE {name} SET {col}={col} WHERE 1=0;'
    if engine=='SQL_SERVER':write+='\nGO\n'
    try:execute(engine,write,db,reader=True)
    except RuntimeError:denied=True
    else:denied=False
    if not denied:raise RuntimeError(f'{engine}: reader unexpectedly permits writes')
    report={'engine':engine,'database':db,'release':SOURCE['release'],'sha256':SOURCE['files'][engine]['sha256'],'counts':counts,'readerWriteDenied':True,'status':'VERIFIED'}
    marker.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
    runtime={**vals,'METADATA_JDBC_URL':'jdbc:postgresql://127.0.0.1:55432/nla_metadata','METADATA_USERNAME':'nla_app','SPRING_PROFILES_ACTIVE':'local','WAREHOUSE_ALLOWED_HOSTS':'127.0.0.1,localhost','CHINOOK_DOCKER':'true'}
    if engine=='MYSQL':
        public_key=compose('exec','-T','mysql','cat','/var/lib/mysql/public_key.pem').stdout
        keyfile=LOCAL/'mysql-public-key.pem';keyfile.write_text(public_key);keyfile.chmod(0o600)
        runtime['NLA_MYSQL_RSA_PUBLIC_KEY']=str(keyfile.resolve())
    elif RUNTIME.exists():
        old=dict(line.split('=',1) for line in RUNTIME.read_text().splitlines() if line)
        if 'NLA_MYSQL_RSA_PUBLIC_KEY' in old:runtime['NLA_MYSQL_RSA_PUBLIC_KEY']=old['NLA_MYSQL_RSA_PUBLIC_KEY']
    runtime['PYTHON_AI_TOKEN']=vals.get('PYTHON_AI_TOKEN','')
    runtime['PYTHON_AI_URL']='http://127.0.0.1:8000'
    RUNTIME.write_text(''.join(f'{k}={v}\n' for k,v in runtime.items()));RUNTIME.chmod(0o600)

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['init','up','provision','verify','status']);p.add_argument('--engine',choices=SOURCE['files']);a=p.parse_args();init()
    if a.action=='init':print('Generated private local credentials; no secrets printed.');return
    if a.action=='up':
        result=compose('up','-d',check=False)
        if result.returncode:print(result.stderr[-1500:],file=sys.stderr);sys.exit(result.returncode)
        print('Database services started. Use status, then provision.');return
    if a.action=='status':print(compose('ps').stdout);return
    for engine in ([a.engine] if a.engine else SOURCE['files']):provision(engine)
if __name__=='__main__':
    try:main()
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
