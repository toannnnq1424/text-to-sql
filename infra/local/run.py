#!/usr/bin/env python3
"""Launch a local service with ignored credentials loaded directly into its environment."""
import os,sys,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
config=ROOT/'.local/docker.env'
if not config.exists():raise SystemExit('Run data/scripts/docker_chinook.py provision first.')
env=dict(os.environ)
for line in config.read_text().splitlines():
    if line and not line.startswith('#'):
        k,v=line.split('=',1);env[k]=v
service=sys.argv[1] if len(sys.argv)>1 else ''
if service=='backend':
    jdk=Path('/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home')
    if jdk.exists():env['JAVA_HOME']=str(jdk)
    cmd=['mvn','-q','spring-boot:run'];cwd=ROOT/'backend'
elif service=='ai':cmd=[str(ROOT/'ai-service/.venv/bin/python'),'-m','uvicorn','app:app','--host','127.0.0.1','--port','8000','--no-access-log'];cwd=ROOT/'ai-service'
elif service=='frontend':
    env.update(VITE_LOCAL_AUTH='true',VITE_ALLOW_ANONYMOUS_DEV='true');cmd=['npm','run','dev'];cwd=ROOT/'frontend'
else:raise SystemExit('Usage: run.py backend|ai|frontend')
os.chdir(cwd);os.execvpe(cmd[0],cmd,env)
