#!/bin/sh
# LibreFunnel installer: the store on this server, in one command.
#
#   curl -fsSL https://librefunnel.com/install | sh
#   curl -fsSL https://librefunnel.com/install | sh -s -- --plan     prints what it would do, does nothing
#
# To read it before it runs: curl -fsSLo install.sh https://librefunnel.com/install, then sh install.sh --help.
# Everything is inside main, which the last line calls, so a download cut short runs nothing.

main() {
  set -eu
  umask 022

  REPO=ToledoSDL/librefunnel
  INSTALL_URL=https://librefunnel.com/install
  GUIDE=https://github.com/$REPO/blob/main/docs/deploy.md
  DOCKER_DOCS=https://docs.docker.com/engine/install/
  # Installed only when Docker has no Compose plugin, or one older than compose.yaml needs (healthcheck start_interval).
  COMPOSE_VERSION=5.5.1
  MIN_COMPOSE=2.23.1
  # The token form with the four permissions below already filled in.
  TOKEN_URL='https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%5D&name=LibreFunnel'
  # A store is these files, .env and the published images: no source code on the server.
  FILES='compose.yaml deploy/Caddyfile deploy/evolution.sql'

  PLAN=0 YES=0 CONFIRMED=0 DIR=/opt/librefunnel DOMAIN_ARG='' EMAIL_ARG='' SSH_FROM=''
  # Each step is its own choice: a flag wins, then what an earlier run stored in .env (INSTALL_*), then the question.
  CF='' CF_DNS='' CF_SSL='' CF_FIREWALL='' R2='' WHATSAPP='' UPDATER='' HARDEN=''
  init_output
  parse_args "$@"

  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64 | Linux-amd64)
      COMPOSE_ASSET=docker-compose-linux-x86_64
      COMPOSE_SHA256=db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576
      ;;
    Linux-aarch64 | Linux-arm64)
      COMPOSE_ASSET=docker-compose-linux-aarch64
      COMPOSE_SHA256=732e3a84c1a0f67256ce80bc2598a24546b10ca05f9faa97efceb1171ece2ef7
      ;;
    *)
      die "O instalador funciona em Linux x64 ou arm64, e este computador é $(uname -s) em $(uname -m)." \
        "Siga o guia manual: $GUIDE"
      ;;
  esac

  TTY=''
  if (exec </dev/tty) 2>/dev/null; then TTY=/dev/tty; fi

  if [ "$(id -u)" != 0 ]; then
    if [ "$PLAN" = 1 ]; then
      warn "Sem root: a instalação de verdade roda de novo com sudo."
    else
      as_root "$@"
    fi
  fi

  if [ "$PLAN" = 1 ]; then
    WORK='<tmp>'
    title "LibreFunnel: plano de instalação (--plan, nada é executado)"
  else
    WORK=$(mktemp -d "${TMPDIR:-/tmp}/librefunnel-install.XXXXXX")
    trap 'rm -rf "$WORK"' EXIT
    title "LibreFunnel: instalação"
  fi

  case $DIR in /*) ;; *) DIR=$PWD/$DIR ;; esac
  ENV_FILE=$DIR/.env
  FRESH=1
  if [ -f "$ENV_FILE" ]; then FRESH=0; fi
  PROJECT=$(basename "$DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
  APT=0
  if command -v apt-get >/dev/null 2>&1; then APT=1; fi

  section "Configuração"
  if [ "$FRESH" = 1 ]; then
    info "Instalação nova em $DIR"
  else
    info "Loja já instalada em $DIR: o que está no .env e as escolhas de antes ficam, só o que falta é perguntado"
  fi
  IP4='' IP6=''
  if [ "$PLAN" = 0 ]; then
    IP4=$(public_ip 4) || IP4=''
    IP6=$(public_ip 6) || IP6=''
  fi
  ask_domain
  ask_email
  ask_password
  ask_choices
  summary

  section "Docker"
  setup_docker
  if [ "$FRESH" = 1 ] && [ "$PLAN" = 0 ] && docker volume inspect "${PROJECT}_postgres" >/dev/null 2>&1; then
    die "Este servidor já tem o banco de uma loja ($PROJECT), mas $ENV_FILE não existe, e a senha do banco está nele." \
      "Rode de novo com --dir apontando para a pasta dessa loja (a que tem o .env)."
  fi

  section "Arquivos"
  fetch_files
  write_env

  if [ "$CF" = 1 ]; then
    section "Cloudflare"
    cloudflare
  fi

  if [ "$HARDEN" = 1 ] || [ "$CF_FIREWALL" = 1 ] || ufw_active; then
    section "Servidor"
    if [ "$HARDEN" = 1 ]; then harden; fi
    firewall
  fi

  section "Loja"
  start_store

  section "Endereço"
  check_https
  finish
}

usage() {
  printf '%s\n' "Instala a LibreFunnel neste servidor, num comando só.

Uso: curl -fsSL $INSTALL_URL | sh -s -- [opções]
     sh install.sh [opções]

  --domain <domínio>   Endereço da loja, como loja.seudominio.com.br.
                       Sem ele, pergunta; o padrão é <IP>.sslip.io, que já funciona sem DNS.
  --email <e-mail>     E-mail para o certificado HTTPS (opcional).

Cada etapa abaixo é uma pergunta (Enter aceita o padrão) e tem a opção de ligar e a de desligar:
  --cloudflare, --no-cloudflare        O domínio está na Cloudflare (padrão: não).
    --cf-dns, --no-cf-dns              Registro A/AAAA do domínio com proxy, nuvem laranja (padrão: sim).
    --cf-ssl, --no-cf-ssl              SSL Full (strict), TLS 1.2 e Always Use HTTPS desligado.
                                       Valem para a zona inteira (padrão: sim).
    --cf-firewall, --no-cf-firewall    Portas 80 e 443 só para a Cloudflare. Só com --cf-dns,
                                       porque sem o proxy a loja ficaria fora do ar (padrão: sim).
    --r2, --no-r2                      R2 para vídeos e imagens, criado pela própria loja (padrão: sim).
  --whatsapp, --no-whatsapp            Liga já o WhatsApp por QR Code (Evolution, uns 300 MB).
                                       Sem ele, dá para ligar depois no painel (padrão: não).
  --updater, --no-updater              Atualizar e reiniciar pelo painel (padrão: sim). Sem ele, as
                                       atualizações são pelo terminal, rodando o instalador de novo.
  --harden, --no-harden                Protege o servidor: firewall, atualizações de segurança,
                                       fail2ban e SSH só por chave (padrão: sim numa instalação nova).

  --ssh-from <ip>      Com o firewall, o SSH aceita só este IP (o padrão é aceitar de qualquer lugar).
  --dir <pasta>        Onde a loja fica (padrão /opt/librefunnel).
  --yes, -y            Não pergunta: usa as opções acima, as escolhas de antes e os padrões.
  --plan, --dry-run    Mostra o que faria e não faz nada.
  -h, --help

Variáveis de ambiente, para não deixar segredos no histórico do terminal:
  LIBREFUNNEL_ADMIN_PASSWORD   senha do painel (sem ela, uma forte é gerada)
  CLOUDFLARE_API_TOKEN         token da Cloudflare (para DNS, SSL e R2)

Rodar de novo é seguro: o que está no .env fica, e as escolhas de antes (INSTALL_* no .env) também.
Para mudar uma escolha, rode de novo com a opção dela.
Guia completo e instalação manual: $GUIDE"
}

parse_args() {
  while [ $# -gt 0 ]; do
    case $1 in
      --plan | --dry-run) PLAN=1 ;;
      --yes | -y) YES=1 ;;
      --cloudflare) CF=1 ;;
      --no-cloudflare) CF=0 ;;
      --cf-dns) CF_DNS=1 ;;
      --no-cf-dns) CF_DNS=0 ;;
      --cf-ssl) CF_SSL=1 ;;
      --no-cf-ssl) CF_SSL=0 ;;
      --cf-firewall) CF_FIREWALL=1 ;;
      --no-cf-firewall) CF_FIREWALL=0 ;;
      --r2) R2=1 ;;
      --no-r2) R2=0 ;;
      --whatsapp) WHATSAPP=1 ;;
      --no-whatsapp) WHATSAPP=0 ;;
      --updater) UPDATER=1 ;;
      --no-updater) UPDATER=0 ;;
      --harden) HARDEN=1 ;;
      --no-harden) HARDEN=0 ;;
      --dir | --domain | --email | --ssh-from)
        [ $# -gt 1 ] || die "$1 precisa de um valor." "Veja sh install.sh --help."
        set_arg "$1" "$2"
        shift
        ;;
      --dir=* | --domain=* | --email=* | --ssh-from=*) set_arg "${1%%=*}" "${1#*=}" ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "Opção desconhecida: $1" "Veja as opções com sh install.sh --help." ;;
    esac
    shift
  done
}

set_arg() {
  case $1 in
    --dir) DIR=$2 ;;
    --domain) DOMAIN_ARG=$2 ;;
    --email) EMAIL_ARG=$2 ;;
    --ssh-from) SSH_FROM=$2 ;;
  esac
}

init_output() {
  B='' D='' G='' Y='' R='' O=''
  if [ -t 1 ] && [ -z "${NO_COLOR+x}" ] && [ "${TERM:-dumb}" != dumb ]; then
    E=$(printf '\033')
    B="${E}[1m" D="${E}[2m" G="${E}[32m" Y="${E}[33m" R="${E}[31m" O="${E}[0m"
  fi
  M_OK=+ M_INFO='-'
  case "${LC_ALL:-}${LC_CTYPE:-}${LANG:-}" in *[Uu][Tt][Ff]*8*) M_OK=✓ M_INFO=· ;; esac
}

title() { printf '\n%s%s%s\n' "$B" "$1" "$O"; }
section() { printf '\n%s%s%s\n' "$B" "$1" "$O"; }
ok() { printf '  %s%s%s %s\n' "$G" "$M_OK" "$O" "$1"; }
info() { printf '  %s %s\n' "$M_INFO" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$O" "$1"; }
shell() { printf '    %s$ %s%s\n' "$D" "$1" "$O"; }
line() { printf '    %s\n' "$1"; }

die() {
  printf '\n  %sx %s%s\n' "$R" "$1" "$O" >&2
  if [ $# -gt 1 ]; then printf '    %s\n' "$2" >&2; fi
  exit 1
}

# Runs a command with its output kept aside; a failure shows the command and the end of its output, and stops.
run() {
  if [ "$PLAN" = 1 ]; then
    case $1 in compose) shell "cd $DIR && docker $*" ;; *) shell "$*" ;; esac
    return 0
  fi
  "$@" >"$WORK/run.log" 2>&1 </dev/null || {
    shell "$*"
    tail -n 15 "$WORK/run.log" | while IFS= read -r l; do printf '    %s%s%s\n' "$D" "$l" "$O" >&2; done
    die "Esse comando falhou." "Corrija o que as últimas linhas acima dizem e rode o instalador de novo."
  }
}

fetch() {
  if [ "$PLAN" = 1 ]; then
    shell "curl -fsSL --proto =https -o $2 $1"
    return 0
  fi
  curl -fsSL --proto =https --retry 3 -o "$2" "$1" ||
    die "Não consegui baixar $1." "Confira a internet do servidor e rode o instalador de novo."
}

verify() {
  if [ "$PLAN" = 1 ]; then return 0; fi
  sum=$(sha256sum "$1")
  if [ "${sum%% *}" != "$2" ]; then
    rm -f "$1"
    die "O download de ${1##*/} não é o arquivo esperado (o SHA-256 é outro), então foi apagado sem rodar." \
      "Rode de novo. Se repetir, abra uma issue: https://github.com/$REPO/issues"
  fi
}

# write FILE: stdin into FILE (shown, not written, with --plan).
write() {
  if [ "$PLAN" = 1 ]; then
    shell "escreve $1"
    cat >/dev/null
    return 0
  fi
  cat >"$1"
}

# Under curl | sh, $0 is the shell, so the published installer is downloaded to run again as root.
as_root() {
  command -v sudo >/dev/null 2>&1 ||
    die "O instalador precisa de root, e este servidor não tem sudo." "Entre como root e rode o mesmo comando."
  script=$0
  if ! is_installer "$script"; then
    script=$(mktemp "${TMPDIR:-/tmp}/librefunnel-install.XXXXXX")
    fetch "$INSTALL_URL" "$script"
  fi
  keep=''
  for name in LIBREFUNNEL_ADMIN_PASSWORD CLOUDFLARE_API_TOKEN SSH_CONNECTION; do
    if eval "[ -n \"\${$name:-}\" ]"; then keep=${keep:+$keep,}$name; fi
  done
  info "Rodando de novo como root (sudo)"
  if [ -n "$keep" ]; then exec sudo --preserve-env="$keep" sh "$script" "$@"; fi
  exec sudo sh "$script" "$@"
}

is_installer() {
  [ -f "$1" ] || return 1
  { IFS= read -r _ && IFS= read -r second; } <"$1" || return 1
  [ "$second" = "# LibreFunnel installer: the store on this server, in one command." ]
}

# ask QUESTION DEFAULT: the answer in ANSWER, or DEFAULT with --yes, --plan or no terminal.
ask() {
  ANSWER=''
  if [ "$YES" = 0 ] && [ "$PLAN" = 0 ] && [ -n "$TTY" ]; then
    if [ -n "$2" ]; then
      printf '  %s? %s%s %s[%s]%s ' "$B" "$1" "$O" "$D" "$2" "$O" >"$TTY"
    else
      printf '  %s? %s%s ' "$B" "$1" "$O" >"$TTY"
    fi
    IFS= read -r ANSWER <"$TTY" || ANSWER=''
  fi
  if [ -z "$ANSWER" ]; then ANSWER=$2; fi
}

# ask_secret QUESTION: typed without echo, in ANSWER.
ask_secret() {
  ANSWER=''
  if [ "$YES" = 0 ] && [ "$PLAN" = 0 ] && [ -n "$TTY" ]; then
    printf '  %s? %s%s ' "$B" "$1" "$O" >"$TTY"
    stty -echo <"$TTY"
    trap 'stty echo <"$TTY"; exit 130' INT TERM HUP
    IFS= read -r ANSWER <"$TTY" || ANSWER=''
    stty echo <"$TTY"
    trap - INT TERM HUP
    printf '\n' >"$TTY"
  fi
}

# yes_no QUESTION DEFAULT(s/n): asked on the terminal; DEFAULT with --yes, --plan or no terminal.
yes_no() {
  if [ "$YES" = 1 ] || [ "$PLAN" = 1 ] || [ -z "$TTY" ]; then
    [ "$2" = s ]
    return
  fi
  hint='s/N'
  if [ "$2" = s ]; then hint='S/n'; fi
  printf '  %s? %s%s %s(%s)%s ' "$B" "$1" "$O" "$D" "$hint" "$O" >"$TTY"
  IFS= read -r yn <"$TTY" || yn=''
  case ${yn:-$2} in [SsYy]*) return 0 ;; *) return 1 ;; esac
}

# confirm QUESTION FIX: yes with --yes, --plan or the summary accepted; asked on a terminal; with no terminal, stops with FIX.
confirm() {
  if [ "$YES" = 1 ] || [ "$PLAN" = 1 ] || [ "$CONFIRMED" = 1 ]; then return 0; fi
  [ -n "$TTY" ] || die "$1 Sem terminal para perguntar, o instalador não faz isso sozinho." "$2"
  yes_no "$1" s || die "Parado a seu pedido." "$2"
}

version_at_least() {
  va=${1#v} vb=${2#v}
  va=${va%%[-+]*} vb=${vb%%[-+]*}
  while [ -n "$va$vb" ]; do
    xa=${va%%.*} xb=${vb%%.*}
    case $xa in '' | *[!0-9]*) xa=0 ;; esac
    case $xb in '' | *[!0-9]*) xb=0 ;; esac
    if [ "$xa" -ne "$xb" ]; then
      [ "$xa" -gt "$xb" ]
      return
    fi
    case $va in *.*) va=${va#*.} ;; *) va='' ;; esac
    case $vb in *.*) vb=${vb#*.} ;; *) vb='' ;; esac
  done
}

# A Docker engine that is still starting can hang without answering.
docker_version() {
  command -v docker >/dev/null 2>&1 || return 1
  timeout 15 docker version --format '{{.Server.Version}}' 2>/dev/null </dev/null
}

wait_docker() {
  i=0
  while [ "$i" -lt 60 ]; do
    if docker_version >/dev/null; then return 0; fi
    sleep 2
    i=$((i + 1))
  done
  die "O Docker foi iniciado, mas não responde depois de 2 minutos." "Veja systemctl status docker e rode o instalador de novo."
}

setup_docker() {
  if v=$(docker_version); then
    ok "Docker $v"
  elif command -v docker >/dev/null 2>&1; then
    confirm "O Docker está instalado, mas parado. Iniciar agora?" "Inicie com systemctl start docker e rode de novo, ou use --yes."
    run systemctl enable --now docker
    if [ "$PLAN" = 0 ]; then
      wait_docker
      ok "Docker $(docker_version), iniciado"
    fi
  else
    confirm "O Docker não está instalado. Instalar agora com o script oficial (get.docker.com)?" \
      "Instale o Docker ($DOCKER_DOCS) e rode de novo, ou use --yes."
    info "Instalando o Docker (um ou dois minutos)"
    fetch https://get.docker.com "$WORK/get-docker.sh"
    run sh "$WORK/get-docker.sh"
    if [ "$PLAN" = 0 ]; then
      if ! docker_version >/dev/null; then
        run systemctl enable --now docker
        wait_docker
      fi
      ok "Docker $(docker_version), instalado"
    fi
  fi
  compose_plugin
}

compose_version() {
  cv=$(docker compose version --short </dev/null 2>/dev/null || :)
  cv=${cv#v}
  case $cv in [0-9]*.[0-9]*) printf '%s' "$cv" ;; esac
}

compose_plugin() {
  have=$(compose_version)
  if [ -n "$have" ] && version_at_least "$have" "$MIN_COMPOSE"; then
    ok "Docker Compose $have"
    return 0
  fi
  plugins=/usr/local/lib/docker/cli-plugins
  info "Instalando o Docker Compose $COMPOSE_VERSION em $plugins (SHA-256 conferido)"
  fetch "https://github.com/docker/compose/releases/download/v$COMPOSE_VERSION/$COMPOSE_ASSET" "$WORK/docker-compose"
  verify "$WORK/docker-compose" "$COMPOSE_SHA256"
  run mkdir -p "$plugins"
  run install -m 755 "$WORK/docker-compose" "$plugins/docker-compose"
  if [ "$PLAN" = 1 ]; then return 0; fi
  version_at_least "$(compose_version)" "$MIN_COMPOSE" ||
    die "O Docker Compose não responde depois de instalado." "Veja o que docker compose version diz e rode de novo."
  ok "Docker Compose $COMPOSE_VERSION"
}

public_ip() {
  curl "-$1" -fsS --max-time 8 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | sed -n 's/^ip=//p'
}

env_get() {
  if [ -f "$ENV_FILE" ]; then sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; fi
}

# env_set KEY VALUE: replaces the KEY line in .env (or adds it); the file stays readable by root only.
env_set() {
  if [ "$PLAN" = 1 ]; then return 0; fi
  (
    umask 077
    ENV_VALUE=$2 awk -v key="$1" '
      BEGIN { value = ENVIRON["ENV_VALUE"] }
      index($0, key "=") == 1 { if (!done) print key "=" value; done = 1; next }
      { print }
      END { if (!done) print key "=" value }
    ' "$ENV_FILE" >"$ENV_FILE.new"
  )
  mv "$ENV_FILE.new" "$ENV_FILE"
}

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

ask_domain() {
  DOMAIN=$(env_get DOMAIN)
  if [ "$DOMAIN" = shop.yourdomain.com ]; then DOMAIN=''; fi
  if [ -n "$DOMAIN_ARG" ]; then DOMAIN=$DOMAIN_ARG; fi
  if [ -n "$DOMAIN" ] && [ -z "$DOMAIN_ARG" ]; then
    ok "Domínio: $DOMAIN"
    return 0
  fi
  if [ -z "$DOMAIN" ]; then
    fallback=''
    if [ -n "$IP4" ]; then fallback=$(printf '%s' "$IP4" | tr . -).sslip.io; fi
    if [ "$PLAN" = 1 ]; then fallback='<IP>.sslip.io'; fi
    if [ -n "$TTY" ] && [ "$YES" = 0 ] && [ "$PLAN" = 0 ]; then
      info "O domínio da loja, como loja.seudominio.com.br. Enter usa $fallback, que funciona sem DNS."
    fi
    ask "Domínio da loja" "$fallback"
    DOMAIN=$ANSWER
  fi
  DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed 's#^https\{0,1\}://##; s#/.*$##')
  [ -n "$DOMAIN" ] || die "Falta o domínio da loja." "Rode com --domain loja.seudominio.com.br."
  if [ "$PLAN" = 0 ] &&
    ! printf '%s' "$DOMAIN" | grep -Eq '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$'; then
    die "\"$DOMAIN\" não é um domínio." "Use só o nome, como loja.seudominio.com.br, sem https:// nem barra."
  fi
  ok "Domínio: $DOMAIN"
}

ask_email() {
  EMAIL=$(env_get ACME_EMAIL)
  if [ -n "$EMAIL_ARG" ]; then EMAIL=$EMAIL_ARG; fi
  if [ -z "$EMAIL" ] && [ "$FRESH" = 1 ] && [ -z "$EMAIL_ARG" ]; then
    ask "E-mail para o certificado HTTPS (opcional, Enter pula)" ''
    EMAIL=$ANSWER
  fi
  case $EMAIL in
    '') ;;
    *@*.*) ok "E-mail do certificado: $EMAIL" ;;
    *) die "\"$EMAIL\" não é um e-mail." "Use um endereço como voce@seudominio.com.br, ou deixe em branco." ;;
  esac
}

ask_password() {
  PASSWORD_SHOWN=''
  if [ -n "$(env_get ADMIN_PASSWORD)" ]; then
    ok "Senha do painel: a que já está no .env"
    PASSWORD=''
    return 0
  fi
  PASSWORD=${LIBREFUNNEL_ADMIN_PASSWORD:-}
  if [ -z "$PASSWORD" ]; then
    ask_secret "Senha do painel, 16 caracteres ou mais (Enter gera uma forte)"
    PASSWORD=$ANSWER
  fi
  if [ -z "$PASSWORD" ]; then
    PASSWORD=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)
    PASSWORD_SHOWN=$PASSWORD
    ok "Senha do painel: gerada (aparece no final, uma vez só)"
    return 0
  fi
  [ "${#PASSWORD}" -ge 16 ] || die "A senha do painel precisa de 16 caracteres ou mais." "Rode de novo e digite outra, ou só Enter para gerar uma."
  case $PASSWORD in
    *[\$\'\"\\#\ ]*) die "A senha do painel não pode ter espaço nem os caracteres \$ ' \" \\ #." "Rode de novo e digite outra, ou só Enter para gerar uma." ;;
  esac
  ok "Senha do painel: a que você digitou"
}

# choose KEY FLAG QUESTION DEFAULT(s/n): 1 or 0 in CHOICE, from the flag, else the choice stored in .env, else the answer.
choose() {
  CHOICE=$2
  if [ -z "$CHOICE" ]; then CHOICE=$(env_get "$1"); fi
  case $CHOICE in
    0 | 1) ;;
    *) if yes_no "$3" "$4"; then CHOICE=1; else CHOICE=0; fi ;;
  esac
}

ask_choices() {
  case $DOMAIN in
    *.sslip.io | *.duckdns.org | '<'*)
      if [ "$CF" = 1 ]; then warn "$DOMAIN não fica na Cloudflare: seguindo sem ela."; fi
      CF=0
      ;;
  esac
  fallback=n
  if [ -n "$(env_get TRUSTED_PROXIES)" ]; then fallback=s; fi
  choose INSTALL_CLOUDFLARE "$CF" "O domínio está na Cloudflare? (DNS, SSL, firewall e R2, cada um com sua pergunta)" "$fallback"
  CF=$CHOICE
  if [ "$CF" = 1 ]; then
    choose INSTALL_CF_DNS "$CF_DNS" "Cloudflare: apontar o domínio para este servidor, com proxy (nuvem laranja)?" s
    CF_DNS=$CHOICE
    choose INSTALL_CF_SSL "$CF_SSL" "Cloudflare: SSL Full (strict), TLS 1.2 e Always Use HTTPS desligado? Vale para a zona inteira" s
    CF_SSL=$CHOICE
    if [ "$CF_DNS" = 1 ]; then
      choose INSTALL_CF_FIREWALL "$CF_FIREWALL" "Cloudflare: portas 80 e 443 só para a Cloudflare (firewall)?" s
      CF_FIREWALL=$CHOICE
    else
      if [ "$CF_FIREWALL" = 1 ]; then warn "Sem o proxy feito pelo instalador, o firewall não fecha para a Cloudflare: a loja ficaria fora do ar."; fi
      CF_FIREWALL=0
    fi
    choose INSTALL_R2 "$R2" "Cloudflare: R2 para vídeos e imagens (bucket privado criado pela loja)?" s
    R2=$CHOICE
  else
    CF_DNS=0 CF_SSL=0 CF_FIREWALL=0 R2=0
  fi
  choose INSTALL_WHATSAPP "$WHATSAPP" "Ligar já o WhatsApp por QR Code (Evolution, uns 300 MB de memória)? Dá para ligar depois no painel" n
  WHATSAPP=$CHOICE
  choose INSTALL_UPDATER "$UPDATER" "Atualizar e reiniciar a loja pelo painel (serviço updater)?" s
  UPDATER=$CHOICE
  fallback=n
  if [ "$FRESH" = 1 ]; then fallback=s; fi
  choose INSTALL_HARDEN "$HARDEN" "Proteger o servidor? Firewall, atualizações de segurança, fail2ban e SSH só por chave (se houver uma)" "$fallback"
  HARDEN=$CHOICE
  if [ "$HARDEN" = 1 ] && [ "$APT" = 0 ]; then
    warn "A proteção do servidor é feita só em Debian e Ubuntu: pulada aqui."
    HARDEN=0
  fi
  ask_token
}

# The token is needed only for DNS, SSL and R2; without it those steps are skipped and stay as they are.
ask_token() {
  CF_TOKEN=''
  if [ "$CF_DNS$CF_SSL$R2" = 000 ] || [ "$CF" = 0 ]; then return 0; fi
  if [ "$PLAN" = 1 ]; then
    CF_TOKEN='<token>'
    return 0
  fi
  CF_TOKEN=${CLOUDFLARE_API_TOKEN:-}
  if [ -z "$CF_TOKEN" ] && [ -n "$TTY" ] && [ "$YES" = 0 ]; then
    info "Crie um token na Cloudflare com estas permissões (o link já abre com elas):"
    line "Zona, Zona, Ler                    (achar o domínio)"
    line "Zona, DNS, Editar                  (apontar o domínio para este servidor)"
    line "Zona, Config. da zona, Editar      (SSL Full strict, TLS 1.2)"
    line "Conta, Armazenamento R2, Editar    (bucket dos vídeos)"
    line "Em Recursos da zona, escolha só $(apex_guess)."
    line "$TOKEN_URL"
    ask_secret "Cole o token (Enter pula DNS, SSL e R2, que ficam como estão)"
    CF_TOKEN=$ANSWER
  fi
  if [ -z "$CF_TOKEN" ]; then
    warn "Sem o token da Cloudflare: DNS, SSL e R2 ficam como estão. Para fazê-los, rode de novo com CLOUDFLARE_API_TOKEN."
    return 0
  fi
  if ! printf '%s' "$CF_TOKEN" | grep -Eq '^[A-Za-z0-9_-]{20,200}$'; then
    die "Esse token da Cloudflare não tem o formato certo." "Copie de novo o valor que a Cloudflare mostrou ao criar o token."
  fi
}

apex_guess() { printf '%s' "$DOMAIN" | awk -F. '{ n = ($(NF-1) ~ /^(com|net|org|gov|edu)$/ && NF > 2) ? 3 : 2; s = $(NF-n+1); for (i = NF-n+2; i <= NF; i++) s = s "." $i; print s }'; }

yes_word() { if [ "$1" = 1 ]; then printf sim; else printf não; fi; }

# One line with every choice, before anything runs.
summary() {
  if [ "$CF" = 1 ]; then
    cloud="Cloudflare (DNS com proxy: $(yes_word "$CF_DNS"), SSL da zona: $(yes_word "$CF_SSL"), firewall: $(yes_word "$CF_FIREWALL"), R2: $(yes_word "$R2"))"
    if [ -z "$CF_TOKEN" ] && [ "$CF_DNS$CF_SSL$R2" != 000 ]; then cloud="$cloud, sem token"; fi
  else
    cloud="sem Cloudflare"
  fi
  if [ "$WHATSAPP" = 1 ]; then
    wa="WhatsApp por QR Code: ligado já"
  elif [ "$UPDATER" = 1 ]; then
    wa="WhatsApp por QR Code: depois, pelo painel"
  else
    wa="WhatsApp por QR Code: só rodando de novo com --whatsapp"
  fi
  if [ "$UPDATER" = 1 ]; then up="atualizações: pelo painel"; else up="atualizações: pelo terminal"; fi
  printf '\n  %sResumo:%s %s; %s; %s; %s; proteção do servidor: %s.\n' "$B" "$O" "$DOMAIN" "$cloud" "$wa" "$up" "$(yes_word "$HARDEN")"
  if [ "$PLAN" = 0 ] && [ "$YES" = 0 ] && [ -n "$TTY" ]; then
    yes_no "Continuar?" s || die "Nada foi feito." "Rode de novo e responda diferente, ou use as opções (sh install.sh --help)."
    CONFIRMED=1
  fi
}

# The version this store is pinned to, or the latest release, so the files match the images.
fetch_files() {
  TAG=$(env_get LIBREFUNNEL_VERSION)
  case $TAG in v[0-9]*.[0-9]*.[0-9]*) ;; *) TAG='' ;; esac
  if [ -z "$TAG" ] && [ "$PLAN" = 0 ]; then
    TAG=$(curl -fsS --max-time 15 "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null |
      sed -n 's/.*"tag_name": *"\(v[0-9][0-9.]*\)".*/\1/p' | head -n 1) || TAG=''
    [ -n "$TAG" ] || die "A LibreFunnel ainda não tem uma versão publicada para instalar (ou o GitHub não respondeu)." \
      "Tente de novo mais tarde, ou siga a instalação manual: $GUIDE"
  fi
  if [ "$PLAN" = 1 ] && [ -z "$TAG" ]; then TAG='<última versão>'; fi
  run mkdir -p "$WORK/files/deploy"
  for f in $FILES .env.example; do fetch "https://raw.githubusercontent.com/$REPO/$TAG/$f" "$WORK/files/$f"; done
  run mkdir -p "$DIR/deploy"
  run chmod 755 "$DIR"
  for f in $FILES; do run cp "$WORK/files/$f" "$DIR/$f"; done
  ok "Versão $TAG em $DIR"
}

write_env() {
  if [ "$FRESH" = 1 ]; then run install -m 600 "$WORK/files/.env.example" "$ENV_FILE"; fi
  env_set DOMAIN "$DOMAIN"
  env_set BASE_URL "https://$DOMAIN"
  if [ -n "$PASSWORD" ]; then env_set ADMIN_PASSWORD "$PASSWORD"; fi
  if [ -z "$(env_get SECRET)" ]; then env_set SECRET "$(random_hex 32)"; fi
  if [ -z "$(env_get POSTGRES_PASSWORD)" ]; then env_set POSTGRES_PASSWORD "$(random_hex 24)"; fi
  if [ -n "$EMAIL" ]; then env_set ACME_EMAIL "$EMAIL"; fi
  # The updater drives compose from another folder: the same project name keeps it on these containers and volumes.
  if [ -z "$(env_get COMPOSE_PROJECT_NAME)" ]; then env_set COMPOSE_PROJECT_NAME "$PROJECT"; fi
  if [ "$FRESH" = 1 ]; then env_set LIBREFUNNEL_VERSION "$TAG"; fi
  env_set INSTALL_CLOUDFLARE "$CF"
  if [ "$CF" = 1 ]; then
    env_set INSTALL_CF_DNS "$CF_DNS"
    env_set INSTALL_CF_SSL "$CF_SSL"
    env_set INSTALL_CF_FIREWALL "$CF_FIREWALL"
    env_set INSTALL_R2 "$R2"
  elif [ -n "$(env_get TRUSTED_PROXIES)" ]; then
    env_set TRUSTED_PROXIES ''
  fi
  env_set INSTALL_WHATSAPP "$WHATSAPP"
  # compose.yaml scales the updater to this, so 0 keeps it off across every docker compose up.
  env_set INSTALL_UPDATER "$UPDATER"
  env_set INSTALL_HARDEN "$HARDEN"
  # The updater turns Evolution on and off from the admin; here it only starts it, never stops what the admin turned on.
  if [ "$WHATSAPP" = 1 ]; then env_set COMPOSE_PROFILES whatsapp; fi
  if [ "$PLAN" = 1 ]; then
    shell "escreve $ENV_FILE (modo 600): DOMAIN, BASE_URL, as escolhas (INSTALL_*) e o que faltar de ADMIN_PASSWORD, SECRET, POSTGRES_PASSWORD"
  else
    ok "$ENV_FILE, legível só pelo root"
  fi
}


# cf METHOD PATH [JSON]: the Cloudflare API with the token in a config on stdin, so it never shows in ps.
cf() {
  if [ $# -gt 2 ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$CF_TOKEN" |
      curl -sS --max-time 20 -K - -X "$1" -H 'Content-Type: application/json' --data "$3" "https://api.cloudflare.com/client/v4$2"
  else
    printf 'header = "Authorization: Bearer %s"\n' "$CF_TOKEN" |
      curl -sS --max-time 20 -K - -X "$1" "https://api.cloudflare.com/client/v4$2"
  fi
}

cf_fail() {
  reason=$(printf '%s' "$2" | jq -r '[.errors[]? | "\(.code): \(.message)"] | join("; ")' 2>/dev/null) || reason=''
  die "$1${reason:+ (Cloudflare: $reason)}" "Confira as permissões do token ($TOKEN_URL) e rode de novo."
}

cloudflare() {
  if [ "$PLAN" = 1 ]; then
    shell "apt-get install jq (se faltar)"
    if [ "$CF_DNS" = 1 ]; then shell "registro A (e AAAA, se o servidor tiver IPv6) $DOMAIN -> IP público, com proxy (nuvem laranja)"; fi
    if [ "$CF_SSL" = 1 ]; then shell "SSL Full (strict), TLS mínimo 1.2, Always Use HTTPS desligado (vale para a zona inteira)"; fi
    shell "TRUSTED_PROXIES no .env com as faixas de https://api.cloudflare.com/client/v4/ips"
    if [ "$R2" = 1 ]; then shell "bucket R2: criado pela própria loja na primeira partida, com o mesmo token"; fi
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    [ "$APT" = 1 ] || die "A conexão com a Cloudflare precisa do jq." "Instale o jq e rode de novo."
    run env DEBIAN_FRONTEND=noninteractive apt-get update -q
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q jq
  fi
  if [ -n "$CF_TOKEN" ] && [ "$CF_DNS$CF_SSL" != 00 ]; then cloudflare_zone; fi

  response=$(curl -fsS --max-time 15 https://api.cloudflare.com/client/v4/ips) ||
    die "Não consegui baixar as faixas de IP da Cloudflare." "Rode de novo em alguns minutos."
  CF_RANGES4=$(printf '%s' "$response" | jq -r '.result.ipv4_cidrs[]' | tr '\n' ' ')
  CF_RANGES6=$(printf '%s' "$response" | jq -r '.result.ipv6_cidrs[]' | tr '\n' ' ')
  [ -n "$CF_RANGES4" ] || die "A Cloudflare não devolveu as faixas de IP." "Rode de novo em alguns minutos."
  env_set TRUSTED_PROXIES "${CF_RANGES4}${CF_RANGES6% }"
  ok "TRUSTED_PROXIES com as faixas atuais da Cloudflare"
}

# The DNS record and the zone settings, the steps that need the token's zone permissions.
cloudflare_zone() {
  ZONE='' name=$DOMAIN
  while [ -z "$ZONE" ]; do
    response=$(cf GET "/zones?name=$name")
    printf '%s' "$response" | jq -e '.success' >/dev/null 2>&1 || cf_fail "O token não consegue ler as zonas." "$response"
    ZONE=$(printf '%s' "$response" | jq -r '.result[0].id // empty')
    zone_status=$(printf '%s' "$response" | jq -r '.result[0].status // empty')
    case $name in *.*.*) [ -n "$ZONE" ] || name=${name#*.} ;; *) break ;; esac
  done
  [ -n "$ZONE" ] || die "A Cloudflare não tem $DOMAIN (nem o domínio acima dele) nas zonas que o token alcança." \
    "Adicione o domínio na Cloudflare, ou crie o token com acesso a ele, e rode de novo."
  ok "Zona $name"
  if [ "$zone_status" != active ]; then
    warn "A zona $name está $zone_status na Cloudflare: troque os nameservers no registro do domínio para os que a Cloudflare mostra."
  fi

  if [ "$CF_DNS" = 1 ]; then
    [ -n "$IP4$IP6" ] || die "Não consegui descobrir o IP público deste servidor." "Confira a internet do servidor e rode de novo."
    for record in "A $IP4" "AAAA $IP6"; do
      type=${record%% *} ip=${record#* }
      response=$(cf GET "/zones/$ZONE/dns_records?type=$type&name=$DOMAIN")
      id=$(printf '%s' "$response" | jq -r '.result[0].id // empty')
      if [ -z "$ip" ]; then
        if [ -n "$id" ]; then warn "Há um registro $type de $DOMAIN, mas este servidor não tem IPv6: apague-o na Cloudflare se ele aponta para outro lugar."; fi
        continue
      fi
      body=$(jq -nc --arg type "$type" --arg name "$DOMAIN" --arg ip "$ip" '{type: $type, name: $name, content: $ip, ttl: 1, proxied: true}')
      if [ -n "$id" ]; then
        response=$(cf PATCH "/zones/$ZONE/dns_records/$id" "$body")
      else
        response=$(cf POST "/zones/$ZONE/dns_records" "$body")
      fi
      printf '%s' "$response" | jq -e '.success' >/dev/null 2>&1 || cf_fail "Não consegui gravar o registro $type de $DOMAIN." "$response"
      ok "DNS: $type $DOMAIN -> $ip, com proxy"
    done
  fi

  if [ "$CF_SSL" = 1 ]; then
    # Caddy redirects to HTTPS itself, and Let's Encrypt validates over plain HTTP through Cloudflare.
    for setting in ssl=strict min_tls_version=1.2 always_use_https=off; do
      key=${setting%%=*} want=${setting#*=}
      response=$(cf GET "/zones/$ZONE/settings/$key")
      have=$(printf '%s' "$response" | jq -r '.result.value // empty')
      if [ "$have" = "$want" ]; then
        ok "$key: $want"
        continue
      fi
      response=$(cf PATCH "/zones/$ZONE/settings/$key" "{\"value\":\"$want\"}")
      printf '%s' "$response" | jq -e '.success' >/dev/null 2>&1 || cf_fail "Não consegui mudar $key da zona." "$response"
      ok "$key: ${have:-?} -> $want (vale para toda a zona $name)"
    done
  fi
}
ufw_active() { command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; }

ssh_ports() {
  ports=22
  current=$(printf '%s' "${SSH_CONNECTION:-}" | awk '{ print $4 }')
  case $current in '' | 22 | *[!0-9]*) ;; *) ports="$ports $current" ;; esac
  printf '%s' "$ports"
}

harden() {
  info "Instalando ufw, fail2ban e unattended-upgrades"
  run env DEBIAN_FRONTEND=noninteractive apt-get update -q
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q ufw fail2ban python3-systemd unattended-upgrades
  printf '%s\n' 'APT::Periodic::Update-Package-Lists "1";' 'APT::Periodic::Unattended-Upgrade "1";' |
    write /etc/apt/apt.conf.d/20auto-upgrades
  ok "Atualizações de segurança automáticas"

  # Minimal images have no auth.log, where the default sshd jail looks.
  printf '%s\n' '[sshd]' 'enabled = true' 'backend = systemd' | write /etc/fail2ban/jail.d/librefunnel.local
  run systemctl enable fail2ban
  run systemctl restart fail2ban
  ok "fail2ban no SSH"

  user=${SUDO_USER:-root}
  home=$(getent passwd "$user" | cut -d: -f6)
  if [ -n "$home" ] && grep -Eqs '(^|[ ,])(ssh-|ecdsa-|sk-)' "$home/.ssh/authorized_keys"; then
    printf '%s\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' | write /etc/ssh/sshd_config.d/10-librefunnel.conf
    run sshd -t
    if [ "$PLAN" = 0 ]; then systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1 || :; fi
    ok "SSH só por chave ($user tem uma em $home/.ssh/authorized_keys)"
  else
    warn "SSH por senha continua ligado: $user não tem chave em ~/.ssh/authorized_keys, e desligar trancaria você fora."
  fi
}

# Docker publishes its ports past ufw's INPUT rules, so the Cloudflare lock lives in DOCKER-USER, which Docker keeps.
firewall() {
  if ! command -v ufw >/dev/null 2>&1; then
    [ "$APT" = 1 ] || die "O firewall da Cloudflare precisa do ufw." "Instale o ufw, ou rode com --no-cf-firewall."
    run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q ufw
  fi
  if [ -n "$SSH_FROM" ]; then
    client=$(printf '%s' "${SSH_CONNECTION:-}" | awk '{ print $1 }')
    if [ -n "$client" ] && [ "$client" != "$SSH_FROM" ]; then
      die "--ssh-from $SSH_FROM, mas você está conectado de $client: o firewall trancaria você fora." \
        "Use --ssh-from $client, ou rode sem --ssh-from."
    fi
  fi
  for port in $(ssh_ports); do
    if [ -n "$SSH_FROM" ]; then
      run ufw allow from "$SSH_FROM" to any port "$port" proto tcp
    else
      run ufw allow "$port/tcp"
    fi
  done

  if [ "$PLAN" = 0 ]; then
    for file in /etc/ufw/after.rules /etc/ufw/after6.rules; do
      sed '/^# BEGIN librefunnel/,/^# END librefunnel/d' "$file" >"$WORK/rules"
      if [ "$CF_FIREWALL" = 1 ]; then
        ranges=$CF_RANGES4
        if [ "$file" = /etc/ufw/after6.rules ]; then ranges=$CF_RANGES6; fi
        docker_user_rules "$ranges" >>"$WORK/rules"
      fi
      cat "$WORK/rules" >"$file"
    done
  fi
  if [ "$CF_FIREWALL" = 1 ]; then
    if [ "$PLAN" = 1 ]; then
      shell "ufw allow proto tcp from <cada faixa da Cloudflare> to any port 80,443"
      shell "acrescenta a /etc/ufw/after.rules e after6.rules: portas 80 e 443 do Docker só para as faixas da Cloudflare"
    fi
    for range in ${CF_RANGES4:-} ${CF_RANGES6:-}; do run ufw allow proto tcp from "$range" to any port 80,443; done
  else
    run ufw allow 80/tcp
    run ufw allow 443/tcp
    run ufw allow 443/udp
  fi
  run ufw --force enable
  run ufw reload
  if [ -n "$SSH_FROM" ]; then ok "Firewall: SSH só de $SSH_FROM"; else ok "Firewall: SSH ($(ssh_ports | tr ' ' ',')) aberto"; fi
  if [ "$CF_FIREWALL" = 1 ]; then ok "Firewall: 80 e 443 só para a Cloudflare"; else ok "Firewall: 80 e 443 abertos"; fi
}

docker_user_rules() {
  printf '%s\n' "# BEGIN librefunnel: ports 80 and 443 of the Docker containers only from Cloudflare (deploy/install.sh)" \
    '*filter' ':DOCKER-USER - [0:0]' ':librefunnel-cloudflare - [0:0]' \
    '-A DOCKER-USER -p tcp -m conntrack --ctstate NEW --ctorigdstport 80 --ctdir ORIGINAL -j librefunnel-cloudflare' \
    '-A DOCKER-USER -p tcp -m conntrack --ctstate NEW --ctorigdstport 443 --ctdir ORIGINAL -j librefunnel-cloudflare' \
    '-A DOCKER-USER -p udp -m conntrack --ctstate NEW --ctorigdstport 443 --ctdir ORIGINAL -j librefunnel-cloudflare'
  for range in $1; do printf '%s\n' "-A librefunnel-cloudflare -s $range -j RETURN"; done
  printf '%s\n' '-A librefunnel-cloudflare -j DROP' 'COMMIT' '# END librefunnel'
}

compose() { docker compose -f "$DIR/compose.yaml" "$@"; }

# compose_up [TOKEN]: up -d, with the Cloudflare token only in this process's environment when given.
compose_up() {
  if [ "$PLAN" = 1 ]; then
    shell "cd $DIR && ${1:+CLOUDFLARE_TOKEN=<token> }docker compose up -d"
    return 0
  fi
  if (CLOUDFLARE_TOKEN=${1:-} && export CLOUDFLARE_TOKEN && compose up -d) >"$WORK/run.log" 2>&1 </dev/null; then
    return 0
  fi
  tail -n 15 "$WORK/run.log" | while IFS= read -r l; do printf '    %s%s%s\n' "$D" "$l" "$O" >&2; done
  die "O docker compose up falhou." "Corrija o que as últimas linhas acima dizem e rode o instalador de novo."
}

wait_app() {
  if [ "$PLAN" = 1 ]; then
    shell "espera o app responder (até 5 minutos)"
    return 0
  fi
  i=0
  while [ "$i" -lt 150 ]; do
    id=$(compose ps -q app 2>/dev/null | head -n 1)
    state=''
    if [ -n "$id" ]; then state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || :); fi
    case $state in
      'running healthy') return 0 ;;
      restarting* | exited* | *unhealthy)
        compose logs --tail 15 app 2>&1 | while IFS= read -r l; do printf '    %s%s%s\n' "$D" "$l" "$O" >&2; done
        die "O app não subiu." "As linhas acima dizem o motivo. Corrija o que elas apontam (as configurações ficam em $ENV_FILE) e rode o instalador de novo."
        ;;
    esac
    sleep 2
    i=$((i + 1))
  done
  die "O app não respondeu em 5 minutos." "Veja cd $DIR && docker compose logs app, e rode o instalador de novo."
}

start_store() {
  info "Baixando as imagens (alguns minutos na primeira vez)"
  if [ "$UPDATER" = 1 ]; then run compose pull app db backup caddy updater; else run compose pull app db backup caddy; fi
  info "Iniciando"
  if [ "$R2" = 1 ] && [ -n "$CF_TOKEN" ]; then compose_up "$CF_TOKEN"; else compose_up ''; fi
  wait_app
  ok "Loja rodando"
  if [ "$UPDATER" = 0 ]; then info "Sem o updater: para atualizar, mude LIBREFUNNEL_VERSION em $ENV_FILE e rode o instalador de novo"; fi
  if [ "$WHATSAPP" = 1 ]; then ok "WhatsApp por QR Code ligado: conecte o número em Conexões"; fi
  if [ "$R2" = 1 ] && [ -n "$CF_TOKEN" ]; then r2; fi
}

# The store connects R2 itself on this start (src/jobs.ts) and logs one line; then it starts again without the token.
r2() {
  code=''
  if [ "$PLAN" = 0 ]; then
    i=0
    while [ -z "$code" ] && [ "$i" -lt 45 ]; do
      code=$(compose logs app 2>/dev/null | sed -n 's/.*\[librefunnel\] r2: \([A-Z0-9_]*\).*/\1/p' | tail -n 1)
      if [ -z "$code" ]; then sleep 2; fi
      i=$((i + 1))
    done
  fi
  case $code in
    OK) ok "R2 conectado: vídeos e imagens vão para o bucket da loja" ;;
    '') if [ "$PLAN" = 0 ]; then warn "R2: a loja não respondeu a tempo. Conecte em Conexões > Cloudflare R2."; fi ;;
    CLOUDFLARE_R2_DISABLED) warn "R2: ative o R2 na sua conta (painel da Cloudflare > R2, plano gratuito) e rode o instalador de novo." ;;
    CLOUDFLARE_PERMISSION) warn "R2: o token não tem a permissão Conta, Armazenamento R2, Editar. Corrija o token e rode de novo." ;;
    *) warn "R2: não conectou ($code). Conecte em Conexões > Cloudflare R2." ;;
  esac
  compose_up ''
  wait_app
  if [ "$PLAN" = 0 ]; then ok "Loja reiniciada sem o token"; fi
}

check_https() {
  if [ "$PLAN" = 1 ]; then
    shell "confere o DNS de $DOMAIN e espera https://$DOMAIN responder (até 3 minutos)"
    return 0
  fi
  # Behind the Cloudflare proxy the name resolves to Cloudflare, so only the HTTPS answer tells.
  if [ "$CF" = 0 ]; then
    points=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR == 1 { print $1 }')
    if [ -z "$IP4" ] || [ "$points" != "$IP4" ]; then
      if [ -n "$points" ]; then
        warn "$DOMAIN aponta para $points, não para este servidor ($IP4)."
      else
        warn "$DOMAIN ainda não existe no DNS."
      fi
      info "Crie este registro onde você gerencia o domínio:"
      line "Tipo A      Nome $DOMAIN      Valor ${IP4:-<IP público do servidor>}"
      if [ -n "$IP6" ]; then line "Tipo AAAA   Nome $DOMAIN      Valor $IP6"; fi
      line "A loja já está rodando: o HTTPS sai sozinho poucos minutos depois que o DNS propagar."
      line "Para conferir, rode o instalador de novo."
      return 0
    fi
  fi
  info "Esperando o HTTPS de $DOMAIN (o certificado sai em um ou dois minutos)"
  i=0
  while [ "$i" -lt 36 ]; do
    if curl -fsS -o /dev/null --max-time 5 "https://$DOMAIN/api/health" 2>/dev/null; then
      ok "https://$DOMAIN responde"
      return 0
    fi
    sleep 5
    i=$((i + 1))
  done
  warn "https://$DOMAIN ainda não responde. Veja o motivo com: cd $DIR && docker compose logs caddy"
}

finish() {
  if [ "$PLAN" = 1 ]; then
    printf '\n%s\n' "Nada foi executado. Sem --plan, o instalador faz o que está acima."
    return 0
  fi
  title "Pronto"
  line "Loja:    https://$DOMAIN"
  line "Painel:  https://$DOMAIN/admin"
  if [ -n "$PASSWORD_SHOWN" ]; then
    line "Senha:   $PASSWORD_SHOWN"
    line "${D}A senha aparece só agora: guarde num gerenciador de senhas. Ela também fica em $ENV_FILE.$O"
  fi
  printf '\n'
  info "Entre no painel e siga os primeiros passos:"
  line "1. Crie seu primeiro produto: preço, chave Pix, vídeo e aulas."
  line "2. Conexões: o e-mail primeiro, sem ele quem compra não recebe o acesso. Depois Pix, WhatsApp e Meta."
  line "3. Configurações: marca, seu e-mail e seu WhatsApp."
  printf '\n'
  line "Mudou algo? Rode o mesmo comando de novo: o que está em $ENV_FILE é mantido."
}

main "$@"
