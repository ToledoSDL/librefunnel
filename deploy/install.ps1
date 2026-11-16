# LibreFunnel installer for Windows: the store on this computer, in one command.
#
#   irm https://librefunnel.com/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://librefunnel.com/install.ps1))) --plan     prints what it would do, does nothing
#
# The options are the ones of the Linux installer (https://librefunnel.com/install), as --yes or -Yes; under Git Bash
# that installer hands over to this one. Everything runs inside one script block, so nothing stays behind in the
# session that ran it, and a failure never closes its window.

& {
  $ErrorActionPreference = 'Stop'
  # The progress bar makes Invoke-WebRequest many times slower in Windows PowerShell 5.1.
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  # Git Bash reads this output through a pipe, in UTF-8.
  if ([Console]::IsOutputRedirected) { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false }

  $Repo = 'ToledoSDL/librefunnel'
  $InstallUrl = 'https://librefunnel.com/install.ps1'
  $Guide = "https://github.com/$Repo/blob/main/docs/deploy.md"
  $DockerDocs = 'https://docs.docker.com/desktop/setup/install/windows-install/'
  $MinCompose = [version]'2.23.1'
  $Files = 'compose.yaml', 'deploy/Caddyfile', 'deploy/evolution.sql'
  $TokenUrl = 'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%5D&name=LibreFunnel'
  $DockerBin = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin'
  $DockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  $Curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  $Utf8 = New-Object Text.UTF8Encoding $false

  function Title($text) { Write-Host ''; Write-Host $text -ForegroundColor White }
  function Ok($text) { Write-Host '  + ' -ForegroundColor Green -NoNewline; Write-Host $text }
  function Info($text) { Write-Host "  - $text" }
  function Warn($text) { Write-Host '  ! ' -ForegroundColor Yellow -NoNewline; Write-Host $text }
  function Shell($text) { Write-Host "    `$ $text" -ForegroundColor DarkGray }
  function Line($text) { Write-Host "    $text" }

  function Stop-Install($message, $fix) {
    Write-Host ''
    Write-Host "  x $message" -ForegroundColor Red
    if ($fix) { Write-Host "    $fix" }
    throw 'LIBREFUNNEL_STOPPED'
  }

  function Show-Usage {
    Write-Host @"
Instala a LibreFunnel neste computador (Windows, com o Docker Desktop), num comando só.

Uso: irm $InstallUrl | iex
     & ([scriptblock]::Create((irm $InstallUrl))) [opções]

  --domain <domínio>   Endereço da loja. O padrão é localhost: a loja abre só neste computador,
                       em https://localhost e https://127.0.0.1.
  --email <e-mail>     E-mail para o certificado HTTPS (só com um domínio de verdade).
  --cloudflare, --no-cloudflare        O domínio está na Cloudflare (padrão: não; só com um domínio).
    --cf-dns, --no-cf-dns              Registro A/AAAA do domínio para este computador, com proxy (padrão: sim).
    --cf-ssl, --no-cf-ssl              SSL Full (strict), TLS 1.2 e Always Use HTTPS desligado (padrão: sim).
    --r2, --no-r2                      R2 para vídeos e imagens, criado pela própria loja (padrão: sim).
  --whatsapp, --no-whatsapp            Liga já o WhatsApp por QR Code (Evolution, uns 300 MB).
  --updater, --no-updater              Atualizar e reiniciar pelo painel (padrão: sim).
  --dir <pasta>        Onde a loja fica (padrão $env:LOCALAPPDATA\LibreFunnel).
  --yes, -y            Não pergunta: usa as opções acima, as escolhas de antes e os padrões.
  --plan, --dry-run    Mostra o que faria e não faz nada.
  -h, --help

As opções também valem no estilo do PowerShell: -Yes, -Plan, -Dir, -NoUpdater, -WhatsApp.
Variáveis de ambiente: LIBREFUNNEL_ADMIN_PASSWORD (senha do painel) e CLOUDFLARE_API_TOKEN.
Rodar de novo é seguro: o que está no .env fica, e as escolhas de antes (INSTALL_* no .env) também.
Guia completo: $Guide
"@
  }

  function Ask($question, $default) {
    if ($Yes -or $Plan -or -not $CanAsk) { return $default }
    $hint = ''
    if ($default) { $hint = " [$default]" }
    $answer = Read-Host "  ? $question$hint"
    if ($answer) { return $answer.Trim() }
    $default
  }

  function Ask-Secret($question) {
    if ($Yes -or $Plan -or -not $CanAsk) { return '' }
    $secure = Read-Host "  ? $question" -AsSecureString
    (New-Object Net.NetworkCredential '', $secure).Password
  }

  # Yes-no question with s or n as the default, which --yes, --plan and a window with no console take.
  function YesNo($question, $default) {
    if ($Yes -or $Plan -or -not $CanAsk) { return $default -eq 's' }
    $hint = 's/N'
    if ($default -eq 's') { $hint = 'S/n' }
    $answer = Read-Host "  ? $question ($hint)"
    if (-not $answer) { $answer = $default }
    $answer -match '^[SsYy]'
  }

  function Confirm-Step($question, $fix) {
    if ($Yes -or $Plan -or $Confirmed) { return }
    if (-not $CanAsk) { Stop-Install "$question Sem um console para perguntar, o instalador não faz isso sozinho." $fix }
    if (-not (YesNo $question 's')) { Stop-Install 'Parado a seu pedido.' $fix }
  }

  # A flag wins, then the choice an earlier run stored in .env, then the question.
  function Choose($key, $flag, $question, $default) {
    if ($flag -ne '') { return $flag }
    $stored = Get-EnvValue $key
    if ($stored -eq '0' -or $stored -eq '1') { return $stored }
    if (YesNo $question $default) { return '1' }
    '0'
  }

  function Get-EnvValue($key) {
    $value = ''
    if (Test-Path -LiteralPath $EnvFile) {
      foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($line.StartsWith("$key=")) { $value = $line.Substring($key.Length + 1) }
      }
    }
    $value
  }

  # The containers read .env, so it stays with LF line endings and no BOM.
  function Set-EnvValue($key, $value) {
    if ($Plan) { return }
    $lines = New-Object Collections.Generic.List[string]
    $done = $false
    foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
      if ($line.StartsWith("$key=")) {
        if (-not $done) { $lines.Add("$key=$value") }
        $done = $true
      } else {
        $lines.Add($line)
      }
    }
    if (-not $done) { $lines.Add("$key=$value") }
    [IO.File]::WriteAllText($EnvFile, ($lines -join "`n") + "`n", $Utf8)
  }

  function Get-RandomBytes($count) {
    $bytes = New-Object byte[] $count
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    $generator.GetBytes($bytes)
    $generator.Dispose()
    $bytes
  }

  function New-Hex($count) { -join (Get-RandomBytes $count | ForEach-Object { $_.ToString('x2') }) }

  function New-Password {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $password = ''
    while ($password.Length -lt 24) {
      # 248 is the largest multiple of 62 under 256, so every character is equally likely.
      foreach ($byte in (Get-RandomBytes 32)) {
        if ($byte -lt 248 -and $password.Length -lt 24) { $password += $alphabet[$byte % 62] }
      }
    }
    $password
  }

  # Runs a command with its output kept aside; a failure shows the command and the end of its output, and stops.
  function Run {
    if ($Plan) { Shell ($args -join ' '); return }
    $command = $args[0]
    $rest = @($args | Select-Object -Skip 1)
    $ErrorActionPreference = 'Continue'
    $output = @(& $command @rest 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0) {
      Shell ($args -join ' ')
      $output | Select-Object -Last 15 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
      Stop-Install 'Esse comando falhou.' 'Corrija o que as últimas linhas acima dizem e rode o instalador de novo.'
    }
  }

  function Compose { Run docker compose -f $ComposeFile @args }

  function Get-Url($url, $path) {
    if ($Plan) { Shell "Invoke-WebRequest $url -OutFile $path"; return }
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $path
    } catch {
      Stop-Install "Não consegui baixar $url." 'Confira a internet deste computador e rode o instalador de novo.'
    }
  }

  function Add-DockerToPath {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath "$DockerBin\docker.exe")) {
      $env:PATH = "$DockerBin;$env:PATH"
    }
  }

  # "version os" of the Docker engine, or empty. A Docker Desktop that is still starting can hang without answering.
  function Get-DockerServer {
    $docker = Get-Command docker -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $docker) { return '' }
    $start = New-Object Diagnostics.ProcessStartInfo $docker.Source, 'version --format "{{.Server.Version}} {{.Server.Os}}"'
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    $process = [Diagnostics.Process]::Start($start)
    $output = $process.StandardOutput.ReadToEndAsync()
    $null = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(15000)) {
      $process.Kill()
      return ''
    }
    if ($process.ExitCode -ne 0) { return '' }
    $output.Result.Trim()
  }

  function Start-DockerDesktop {
    if ($Plan) {
      Shell "Start-Process '$DockerDesktop'"
      Shell 'espera o Docker responder (até 5 minutos)'
      return
    }
    Start-Process -FilePath $DockerDesktop
    Info 'Esperando o Docker Desktop. Na primeira vez ele pede para aceitar os termos de uso: aceite na janela dele.'
    for ($i = 0; $i -lt 100; $i++) {
      if (Get-DockerServer) { return }
      Start-Sleep -Seconds 3
    }
    Stop-Install 'O Docker Desktop foi aberto, mas não responde depois de 5 minutos.' `
      'Veja o que a janela do Docker Desktop pede (aceitar os termos, instalar o WSL ou reiniciar o Windows) e rode o instalador de novo.'
  }

  function Initialize-Docker {
    Add-DockerToPath
    $server = Get-DockerServer
    if (-not $server) {
      if (Test-Path -LiteralPath $DockerDesktop) {
        Confirm-Step 'O Docker Desktop está instalado, mas parado. Abrir agora?' `
          'Abra o Docker Desktop, espere ele dizer Engine running e rode de novo, ou use --yes.'
      } else {
        Confirm-Step 'O Docker Desktop não está instalado. Instalar agora com o winget (winget install Docker.DockerDesktop)?' `
          "Instale o Docker Desktop ($DockerDocs), abra e rode de novo, ou use --yes."
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
          Stop-Install 'Este Windows não tem o winget para instalar o Docker Desktop.' "Instale o Docker Desktop ($DockerDocs), abra e rode o instalador de novo."
        }
        Info 'Instalando o Docker Desktop (alguns minutos; o Windows pede permissão de administrador)'
        Run winget install --exact --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
        Add-DockerToPath
        if (-not $Plan) { Ok 'Docker Desktop instalado' }
      }
      Start-DockerDesktop
      if ($Plan) { return }
      $server = Get-DockerServer
    }
    $version, $os = $server -split ' '
    if ($os -ne 'linux') {
      Stop-Install 'O Docker Desktop está com contêineres Windows, e a loja usa contêineres Linux.' `
        'Clique com o botão direito no ícone do Docker, perto do relógio, escolha Switch to Linux containers e rode de novo.'
    }
    Ok "Docker $version"
    $compose = ((docker compose version --short) -replace '^v', '' -replace '[-+].*$', '')
    if (-not $compose -or [version]$compose -lt $MinCompose) {
      Stop-Install "O Docker Compose deste Docker Desktop ($compose) é antigo: a loja precisa do $MinCompose ou mais novo." `
        'Atualize o Docker Desktop (menu Check for updates) e rode o instalador de novo.'
    }
    Ok "Docker Compose $compose"
  }

  function Get-PublicIp($family) {
    $ErrorActionPreference = 'Continue'
    $trace = & $Curl "-$family" -fs --max-time 8 https://cloudflare.com/cdn-cgi/trace
    if ($LASTEXITCODE -ne 0) { return '' }
    ($trace | Where-Object { $_ -like 'ip=*' }) -replace '^ip=', ''
  }

  function Test-Https($url, $options) {
    $ErrorActionPreference = 'Continue'
    & $Curl -fs -o NUL --max-time 5 @options "$url/api/health"
    $LASTEXITCODE -eq 0
  }

  # Cloudflare's API; a refusal comes back as its parsed error body, so the codes can be shown.
  function Invoke-Cloudflare($method, $path, $body) {
    $request = @{ Method = $method; Uri = "https://api.cloudflare.com/client/v4$path"; Headers = @{ Authorization = "Bearer $CfToken" }; UseBasicParsing = $true }
    if ($body) {
      $request.Body = $body | ConvertTo-Json -Compress
      $request.ContentType = 'application/json'
    }
    try {
      Invoke-RestMethod @request
    } catch {
      try { $_.ErrorDetails.Message | ConvertFrom-Json } catch { [pscustomobject]@{ success = $false } }
    }
  }

  function Stop-Cloudflare($message, $response) {
    $reason = (@($response.errors) | Where-Object { $_ } | ForEach-Object { "$($_.code): $($_.message)" }) -join '; '
    if ($reason) { $message = "$message (Cloudflare: $reason)" }
    Stop-Install $message "Confira as permissões do token ($TokenUrl) e rode de novo."
  }

  function Set-Cloudflare {
    if ($Plan) {
      if ($CfDns -eq '1') { Shell "registro A (e AAAA, se houver IPv6) $Domain -> IP público deste computador, com proxy" }
      if ($CfSsl -eq '1') { Shell 'SSL Full (strict), TLS mínimo 1.2, Always Use HTTPS desligado (vale para a zona inteira)' }
      Shell 'TRUSTED_PROXIES no .env com as faixas de https://api.cloudflare.com/client/v4/ips'
      if ($R2 -eq '1') { Shell 'bucket R2: criado pela própria loja na primeira partida, com o mesmo token' }
      return
    }
    if ($CfToken -and "$CfDns$CfSsl" -ne '00') {
      $zone = $null
      $name = $Domain
      while (-not $zone) {
        $response = Invoke-Cloudflare GET "/zones?name=$name"
        if (-not $response.success) { Stop-Cloudflare 'O token não consegue ler as zonas.' $response }
        $zone = @($response.result)[0]
        if ($zone -or ($name.Split('.').Count -le 2)) { break }
        $name = $name.Substring($name.IndexOf('.') + 1)
      }
      if (-not $zone) {
        Stop-Install "A Cloudflare não tem $Domain (nem o domínio acima dele) nas zonas que o token alcança." `
          'Adicione o domínio na Cloudflare, ou crie o token com acesso a ele, e rode de novo.'
      }
      Ok "Zona $name"
      if ($zone.status -ne 'active') { Warn "A zona $name está $($zone.status) na Cloudflare: troque os nameservers no registro do domínio para os que a Cloudflare mostra." }

      if ($CfDns -eq '1') {
        $ips = @{ A = Get-PublicIp 4; AAAA = Get-PublicIp 6 }
        if (-not ($ips.A + $ips.AAAA)) { Stop-Install 'Não consegui descobrir o IP público deste computador.' 'Confira a internet e rode de novo.' }
        foreach ($type in 'A', 'AAAA') {
          $ip = $ips[$type]
          $existing = @((Invoke-Cloudflare GET "/zones/$($zone.id)/dns_records?type=$type&name=$Domain").result)[0]
          if (-not $ip) {
            if ($existing) { Warn "Há um registro $type de $Domain, mas este computador não tem IPv6: apague-o na Cloudflare se ele aponta para outro lugar." }
            continue
          }
          $record = @{ type = $type; name = $Domain; content = $ip; ttl = 1; proxied = $true }
          if ($existing) {
            $response = Invoke-Cloudflare PATCH "/zones/$($zone.id)/dns_records/$($existing.id)" $record
          } else {
            $response = Invoke-Cloudflare POST "/zones/$($zone.id)/dns_records" $record
          }
          if (-not $response.success) { Stop-Cloudflare "Não consegui gravar o registro $type de $Domain." $response }
          Ok "DNS: $type $Domain -> $ip, com proxy"
        }
        Warn 'Para a internet chegar à loja, o roteador precisa encaminhar as portas 80 e 443 para este computador.'
      }

      if ($CfSsl -eq '1') {
        # Caddy redirects to HTTPS itself, and Let's Encrypt validates over plain HTTP through Cloudflare.
        foreach ($setting in @(@('ssl', 'strict'), @('min_tls_version', '1.2'), @('always_use_https', 'off'))) {
          $key, $want = $setting
          $have = (Invoke-Cloudflare GET "/zones/$($zone.id)/settings/$key").result.value
          if ($have -eq $want) {
            Ok "${key}: $want"
            continue
          }
          $response = Invoke-Cloudflare PATCH "/zones/$($zone.id)/settings/$key" @{ value = $want }
          if (-not $response.success) { Stop-Cloudflare "Não consegui mudar $key da zona." $response }
          Ok "${key}: $have -> $want (vale para toda a zona $name)"
        }
      }
    }

    try {
      $ranges = (Invoke-RestMethod -UseBasicParsing -Uri 'https://api.cloudflare.com/client/v4/ips').result
    } catch {
      Stop-Install 'Não consegui baixar as faixas de IP da Cloudflare.' 'Rode de novo em alguns minutos.'
    }
    Set-EnvValue TRUSTED_PROXIES ((@($ranges.ipv4_cidrs) + @($ranges.ipv6_cidrs)) -join ' ')
    Ok 'TRUSTED_PROXIES com as faixas atuais da Cloudflare'
  }

  # up -d, with the Cloudflare token only in this process's environment when given.
  function Start-Compose($token) {
    if ($Plan) {
      $prefix = ''
      if ($token) { $prefix = 'CLOUDFLARE_TOKEN=<token> ' }
      Shell "${prefix}docker compose -f $ComposeFile up -d"
      return
    }
    $env:CLOUDFLARE_TOKEN = $token
    try { Compose up -d } finally { Remove-Item Env:CLOUDFLARE_TOKEN -ErrorAction SilentlyContinue }
  }

  function Wait-App {
    if ($Plan) { Shell 'espera o app responder (até 5 minutos)'; return }
    $ErrorActionPreference = 'Continue'
    for ($i = 0; $i -lt 150; $i++) {
      $id = @(docker compose -f $ComposeFile ps -q app 2>$null)[0]
      $state = ''
      if ($id) { $state = docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' $id 2>$null }
      if ($state -eq 'running healthy') { return }
      if ($state -match '^(restarting|exited)|unhealthy$') {
        docker compose -f $ComposeFile logs --tail 15 app 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Stop-Install 'O app não subiu.' "As linhas acima dizem o motivo. Corrija o que elas apontam (as configurações ficam em $EnvFile) e rode o instalador de novo."
      }
      Start-Sleep -Seconds 2
    }
    Stop-Install 'O app não respondeu em 5 minutos.' "Veja docker compose -f `"$ComposeFile`" logs app, e rode o instalador de novo."
  }

  # The store connects R2 itself on this start and logs one line; then it starts again without the token.
  function Connect-R2 {
    $code = ''
    if (-not $Plan) {
      $ErrorActionPreference = 'Continue'
      for ($i = 0; -not $code -and $i -lt 45; $i++) {
        $found = docker compose -f $ComposeFile logs app 2>$null | Select-String '\[librefunnel\] r2: ([A-Z0-9_]+)' | Select-Object -Last 1
        if ($found) { $code = $found.Matches[0].Groups[1].Value } else { Start-Sleep -Seconds 2 }
      }
    }
    switch ($code) {
      'OK' { Ok 'R2 conectado: vídeos e imagens vão para o bucket da loja' }
      '' { if (-not $Plan) { Warn 'R2: a loja não respondeu a tempo. Conecte em Conexões > Cloudflare R2.' } }
      'CLOUDFLARE_R2_DISABLED' { Warn 'R2: ative o R2 na sua conta (painel da Cloudflare > R2, plano gratuito) e rode o instalador de novo.' }
      'CLOUDFLARE_PERMISSION' { Warn 'R2: o token não tem a permissão Conta, Armazenamento R2, Editar. Corrija o token e rode de novo.' }
      default { Warn "R2: não conectou ($code). Conecte em Conexões > Cloudflare R2." }
    }
    Start-Compose ''
    Wait-App
    if (-not $Plan) { Ok 'Loja reiniciada sem o token' }
  }

  try {
    $Plan = $false; $Yes = $false; $Confirmed = $false
    $Dir = ''; $DomainArg = ''; $EmailArg = ''
    $Cf = ''; $CfDns = ''; $CfSsl = ''; $R2 = ''; $WhatsApp = ''; $Updater = ''
    $LinuxOnly = @()
    for ($i = 0; $i -lt $args.Count; $i++) {
      $arg = [string]$args[$i]
      $value = $null
      if ($arg -match '^(-[^=]+)=(.*)$') { $arg = $Matches[1]; $value = $Matches[2] }
      $name = ($arg -replace '-', '').ToLowerInvariant()
      if ($name -in 'dir', 'domain', 'email', 'sshfrom') {
        if ($null -eq $value) {
          if ($i + 1 -ge $args.Count) { Stop-Install "$arg precisa de um valor." 'Veja as opções com --help.' }
          $i++
          $value = [string]$args[$i]
        }
      }
      switch ($name) {
        { $_ -in 'plan', 'dryrun' } { $Plan = $true }
        { $_ -in 'yes', 'y' } { $Yes = $true }
        'dir' { $Dir = $value }
        'domain' { $DomainArg = $value }
        'email' { $EmailArg = $value }
        'cloudflare' { $Cf = '1' }
        'nocloudflare' { $Cf = '0' }
        'cfdns' { $CfDns = '1' }
        'nocfdns' { $CfDns = '0' }
        'cfssl' { $CfSsl = '1' }
        'nocfssl' { $CfSsl = '0' }
        'r2' { $R2 = '1' }
        'nor2' { $R2 = '0' }
        'whatsapp' { $WhatsApp = '1' }
        'nowhatsapp' { $WhatsApp = '0' }
        'updater' { $Updater = '1' }
        'noupdater' { $Updater = '0' }
        { $_ -in 'harden', 'noharden', 'cffirewall', 'nocffirewall', 'sshfrom' } { $LinuxOnly += $arg }
        { $_ -in 'help', 'h' } { Show-Usage; return }
        default { Stop-Install "Opção desconhecida: $arg" 'Veja as opções com --help.' }
      }
    }
    $CanAsk = -not [Console]::IsInputRedirected

    if ($Plan) { Title 'LibreFunnel: plano de instalação (--plan, nada é executado)' } else { Title 'LibreFunnel: instalação' }
    if ($LinuxOnly) { Warn "$($LinuxOnly -join ', '): proteção e firewall são só para servidores Linux, ignorados aqui." }

    if (-not $Dir) { $Dir = Join-Path $env:LOCALAPPDATA 'LibreFunnel' }
    if (-not [IO.Path]::IsPathRooted($Dir)) { $Dir = Join-Path (Get-Location).Path $Dir }
    $Dir = [IO.Path]::GetFullPath($Dir).TrimEnd('\', '/')
    $EnvFile = Join-Path $Dir '.env'
    $ComposeFile = Join-Path $Dir 'compose.yaml'
    $Fresh = -not (Test-Path -LiteralPath $EnvFile)
    $Project = (Split-Path -Leaf $Dir).ToLowerInvariant() -replace '[^a-z0-9_-]', ''

    Title 'Configuração'
    if ($Fresh) { Info "Instalação nova em $Dir" } else { Info "Loja já instalada em ${Dir}: o que está no .env e as escolhas de antes ficam, só o que falta é perguntado" }

    # A local store answers on 127.0.0.1 too, since localhost can hang over IPv6 with Docker Desktop.
    $Domain = (Get-EnvValue DOMAIN) -replace ' .*$', ''
    if ($Domain -eq 'shop.yourdomain.com') { $Domain = '' }
    if ($DomainArg) { $Domain = $DomainArg }
    if (-not $Domain) {
      if (-not $Yes -and -not $Plan -and $CanAsk) {
        Info 'Enter usa localhost: a loja abre só neste computador, para testar. Para vender pela internet, use um servidor (veja o guia).'
      }
      $Domain = Ask 'Domínio da loja' 'localhost'
    }
    $Domain = $Domain.ToLowerInvariant() -replace '^https?://', '' -replace '/.*$', ''
    $Local = $Domain -eq 'localhost'
    if (-not $Local -and $Domain -notmatch '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$') {
      Stop-Install "`"$Domain`" não é um domínio." 'Use só o nome, como loja.seudominio.com.br, sem https:// nem barra, ou localhost.'
    }
    $Site = $Domain
    if ($Local) { $Site = 'localhost 127.0.0.1' }
    Ok "Domínio: $Domain"

    $Email = Get-EnvValue ACME_EMAIL
    if ($EmailArg) { $Email = $EmailArg }
    if (-not $Email -and $Fresh -and -not $EmailArg -and -not $Local) { $Email = Ask 'E-mail para o certificado HTTPS (opcional, Enter pula)' '' }
    if ($Email -and $Email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
      Stop-Install "`"$Email`" não é um e-mail." 'Use um endereço como voce@seudominio.com.br, ou deixe em branco.'
    }
    if ($Email) { Ok "E-mail do certificado: $Email" }

    $Password = ''
    $PasswordShown = ''
    if (Get-EnvValue ADMIN_PASSWORD) {
      Ok 'Senha do painel: a que já está no .env'
    } else {
      $Password = $env:LIBREFUNNEL_ADMIN_PASSWORD
      if (-not $Password) { $Password = Ask-Secret 'Senha do painel, 16 caracteres ou mais (Enter gera uma forte)' }
      if (-not $Password) {
        $Password = New-Password
        $PasswordShown = $Password
        Ok 'Senha do painel: gerada (aparece no final, uma vez só)'
      } else {
        if ($Password.Length -lt 16) { Stop-Install 'A senha do painel precisa de 16 caracteres ou mais.' 'Rode de novo e digite outra, ou só Enter para gerar uma.' }
        if ($Password -match '[$''"\\# ]') { Stop-Install 'A senha do painel não pode ter espaço nem os caracteres $ '' " \ #.' 'Rode de novo e digite outra, ou só Enter para gerar uma.' }
        Ok 'Senha do painel: a que você digitou'
      }
    }

    if ($Local) {
      if ($Cf -eq '1') { Warn 'localhost não fica na Cloudflare: seguindo sem ela.' }
      $Cf = '0'
    }
    $fallback = 'n'
    if (Get-EnvValue TRUSTED_PROXIES) { $fallback = 's' }
    $Cf = Choose INSTALL_CLOUDFLARE $Cf 'O domínio está na Cloudflare? (DNS, SSL e R2, cada um com sua pergunta)' $fallback
    if ($Cf -eq '1') {
      $CfDns = Choose INSTALL_CF_DNS $CfDns 'Cloudflare: apontar o domínio para este computador, com proxy (nuvem laranja)?' 's'
      $CfSsl = Choose INSTALL_CF_SSL $CfSsl 'Cloudflare: SSL Full (strict), TLS 1.2 e Always Use HTTPS desligado? Vale para a zona inteira' 's'
      $R2 = Choose INSTALL_R2 $R2 'Cloudflare: R2 para vídeos e imagens (bucket privado criado pela loja)?' 's'
    } else {
      $CfDns = '0'; $CfSsl = '0'; $R2 = '0'
    }
    $WhatsApp = Choose INSTALL_WHATSAPP $WhatsApp 'Ligar já o WhatsApp por QR Code (Evolution, uns 300 MB de memória)? Dá para ligar depois no painel' 'n'
    $Updater = Choose INSTALL_UPDATER $Updater 'Atualizar e reiniciar a loja pelo painel (serviço updater)?' 's'

    $CfToken = ''
    if ($Cf -eq '1' -and "$CfDns$CfSsl$R2" -ne '000') {
      if ($Plan) {
        $CfToken = '<token>'
      } else {
        $CfToken = $env:CLOUDFLARE_API_TOKEN
        if (-not $CfToken -and -not $Yes -and $CanAsk) {
          Info 'Crie um token na Cloudflare com estas permissões (o link já abre com elas):'
          Line 'Zona, Zona, Ler                    (achar o domínio)'
          Line 'Zona, DNS, Editar                  (apontar o domínio para este computador)'
          Line 'Zona, Config. da zona, Editar      (SSL Full strict, TLS 1.2)'
          Line 'Conta, Armazenamento R2, Editar    (bucket dos vídeos)'
          Line $TokenUrl
          $CfToken = Ask-Secret 'Cole o token (Enter pula DNS, SSL e R2, que ficam como estão)'
        }
        if (-not $CfToken) {
          Warn 'Sem o token da Cloudflare: DNS, SSL e R2 ficam como estão. Para fazê-los, rode de novo com CLOUDFLARE_API_TOKEN.'
        } elseif ($CfToken -notmatch '^[A-Za-z0-9_-]{20,200}$') {
          Stop-Install 'Esse token da Cloudflare não tem o formato certo.' 'Copie de novo o valor que a Cloudflare mostrou ao criar o token.'
        }
      }
    }

    $words = @{ '1' = 'sim'; '0' = 'não' }
    $cloud = 'sem Cloudflare'
    if ($Cf -eq '1') {
      $cloud = "Cloudflare (DNS com proxy: $($words[$CfDns]), SSL da zona: $($words[$CfSsl]), R2: $($words[$R2]))"
      if (-not $CfToken) { $cloud += ', sem token' }
    }
    $wa = 'WhatsApp por QR Code: só rodando de novo com --whatsapp'
    if ($Updater -eq '1') { $wa = 'WhatsApp por QR Code: depois, pelo painel' }
    if ($WhatsApp -eq '1') { $wa = 'WhatsApp por QR Code: ligado já' }
    $up = 'atualizações: pelo terminal'
    if ($Updater -eq '1') { $up = 'atualizações: pelo painel' }
    Write-Host ''
    Write-Host "  Resumo: $Domain; $cloud; $wa; $up." -ForegroundColor White
    if (-not $Plan -and -not $Yes -and $CanAsk) {
      if (-not (YesNo 'Continuar?' 's')) { Stop-Install 'Nada foi feito.' 'Rode de novo e responda diferente, ou use as opções (--help).' }
      $Confirmed = $true
    }

    Title 'Docker'
    Initialize-Docker
    if ($Fresh -and -not $Plan) {
      $ErrorActionPreference = 'Continue'
      docker volume inspect "${Project}_postgres" *> $null
      $taken = $LASTEXITCODE -eq 0
      $ErrorActionPreference = 'Stop'
      if ($taken) {
        Stop-Install "Este computador já tem o banco de uma loja ($Project), mas $EnvFile não existe, e a senha do banco está nele." `
          'Rode de novo com --dir apontando para a pasta dessa loja (a que tem o .env).'
      }
    }

    Title 'Arquivos'
    # The version this store is pinned to, or the latest release, so the files match the images.
    $Tag = Get-EnvValue LIBREFUNNEL_VERSION
    if ($Tag -notmatch '^v\d+\.\d+\.\d+$') { $Tag = '' }
    if (-not $Tag -and -not $Plan) {
      try { $Tag = (Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest").tag_name } catch { $Tag = '' }
      if ($Tag -notmatch '^v\d+\.\d+\.\d+$') {
        Stop-Install 'A LibreFunnel ainda não tem uma versão publicada para instalar (ou o GitHub não respondeu).' "Tente de novo mais tarde, ou siga a instalação manual: $Guide"
      }
    }
    if (-not $Tag) { $Tag = '<última versão>' }
    $Work = Join-Path ([IO.Path]::GetTempPath()) "librefunnel-install-$(New-Hex 6)"
    try {
      if (-not $Plan) { New-Item -ItemType Directory -Force (Join-Path $Work 'deploy'), (Join-Path $Dir 'deploy') | Out-Null }
      foreach ($file in $Files + '.env.example') { Get-Url "https://raw.githubusercontent.com/$Repo/$Tag/$file" (Join-Path $Work $file) }
      foreach ($file in $Files) {
        if ($Plan) { Shell "copia $file para $Dir" } else { Copy-Item -LiteralPath (Join-Path $Work $file) -Destination (Join-Path $Dir $file) -Force }
      }
      if ($Fresh -and -not $Plan) { [IO.File]::WriteAllText($EnvFile, [IO.File]::ReadAllText((Join-Path $Work '.env.example')).Replace("`r`n", "`n"), $Utf8) }
    } finally {
      if (-not $Plan) { Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue }
    }
    # The image digest published with the release: Docker then refuses an image changed in the registry after it.
    # Releases published before images.txt existed have none, and those keep pulling by tag.
    $Digest = ''
    $UpdaterDigest = ''
    if (-not $Plan) {
      try {
        $Response = Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/releases/download/$Tag/images.txt"
        $Images = [Text.Encoding]::UTF8.GetString($Response.RawContentStream.ToArray())
        if ($Images -match '(?m)^app=(sha256:[0-9a-f]{64})$') { $Digest = $Matches[1] }
        if ($Images -match '(?m)^updater=(sha256:[0-9a-f]{64})$') { $UpdaterDigest = $Matches[1] }
      } catch { $Digest = '' }
    }
    Ok "Versão $Tag em $Dir"

    Set-EnvValue DOMAIN $Site
    Set-EnvValue BASE_URL "https://$Domain"
    if ($Password) { Set-EnvValue ADMIN_PASSWORD $Password }
    if (-not (Get-EnvValue SECRET)) { Set-EnvValue SECRET (New-Hex 32) }
    # deploy/evolution.sql creates Evolution's own database user only on a new database, so only a new store gets its password.
    if (-not (Get-EnvValue POSTGRES_PASSWORD)) {
      Set-EnvValue POSTGRES_PASSWORD (New-Hex 24)
      Set-EnvValue EVOLUTION_DB_PASSWORD (New-Hex 24)
    }
    # Separate keys, so a compromised Evolution cannot call the updater.
    if (-not (Get-EnvValue EVOLUTION_KEY)) { Set-EnvValue EVOLUTION_KEY (New-Hex 24) }
    if (-not (Get-EnvValue UPDATER_TOKEN)) { Set-EnvValue UPDATER_TOKEN (New-Hex 24) }
    if ($Email) { Set-EnvValue ACME_EMAIL $Email }
    # The updater drives compose from another folder: the same project name keeps it on these containers and volumes.
    if (-not (Get-EnvValue COMPOSE_PROJECT_NAME)) { Set-EnvValue COMPOSE_PROJECT_NAME $Project }
    if ($Fresh) { Set-EnvValue LIBREFUNNEL_VERSION $Tag }
    Set-EnvValue LIBREFUNNEL_DIGEST $Digest
    Set-EnvValue LIBREFUNNEL_UPDATER_DIGEST $UpdaterDigest
    Set-EnvValue INSTALL_CLOUDFLARE $Cf
    if ($Cf -eq '1') {
      Set-EnvValue INSTALL_CF_DNS $CfDns
      Set-EnvValue INSTALL_CF_SSL $CfSsl
      Set-EnvValue INSTALL_R2 $R2
    } elseif (Get-EnvValue TRUSTED_PROXIES) {
      Set-EnvValue TRUSTED_PROXIES ''
    }
    Set-EnvValue INSTALL_WHATSAPP $WhatsApp
    # compose.yaml scales the updater to this, so 0 keeps it off across every docker compose up.
    Set-EnvValue INSTALL_UPDATER $Updater
    if ($WhatsApp -eq '1') { Set-EnvValue COMPOSE_PROFILES whatsapp }
    if ($Plan) { Shell "escreve $EnvFile`: DOMAIN, BASE_URL, as escolhas (INSTALL_*) e o que faltar de ADMIN_PASSWORD, SECRET, POSTGRES_PASSWORD, EVOLUTION_KEY, UPDATER_TOKEN" } else { Ok $EnvFile }

    if ($Cf -eq '1') {
      Title 'Cloudflare'
      Set-Cloudflare
    }

    Title 'Loja'
    Info 'Baixando as imagens (alguns minutos na primeira vez)'
    $services = @('app', 'db', 'backup', 'caddy')
    if ($Updater -eq '1') { $services += 'updater' }
    # A release tag never changes, so an image already on this computer is not downloaded again.
    Compose pull --policy missing @services
    Info 'Iniciando'
    $withR2 = $R2 -eq '1' -and $CfToken
    if ($withR2) { Start-Compose $CfToken } else { Start-Compose '' }
    Wait-App
    if (-not $Plan) { Ok 'Loja rodando' }
    if ($Updater -eq '0') { Info "Sem o updater: para atualizar, mude LIBREFUNNEL_VERSION em $EnvFile e rode o instalador de novo" }
    if ($WhatsApp -eq '1') { Ok 'WhatsApp por QR Code ligado: conecte o número em Conexões' }
    if ($withR2) { Connect-R2 }

    Title 'Endereço'
    $Url = "https://$Domain"
    if ($Plan) {
      Shell "espera $Url responder (até 3 minutos)"
      Write-Host ''
      Write-Host 'Nada foi executado. Sem --plan, o instalador faz o que está acima.'
      return
    }
    # The certificate of a local store comes from Caddy's own authority, which Windows does not trust.
    $probe = @()
    if ($Local) { $probe = @('-k', '--resolve', 'localhost:443:127.0.0.1') }
    Info "Esperando o HTTPS de $Url"
    $answered = $false
    for ($i = 0; -not $answered -and $i -lt 36; $i++) {
      $answered = Test-Https $Url $probe
      if (-not $answered) { Start-Sleep -Seconds 5 }
    }
    $Urls = @($Url)
    if (-not $answered) {
      if ($Local) {
        Warn "$Url ainda não responde. Veja o motivo com: docker compose -f `"$ComposeFile`" logs caddy"
      } else {
        Warn "$Url ainda não responde. O domínio precisa apontar para este computador, e o roteador encaminhar as portas 80 e 443 para ele."
      }
    } elseif ($Local) {
      Ok "$Url responde"
      if (Test-Https 'https://127.0.0.1' @('-k')) { $Urls += 'https://127.0.0.1' }
      if (-not (Test-Https $Url @('-k'))) {
        $owner = Get-NetTCPConnection -LocalAddress '::1' -LocalPort 443 -State Listen -ErrorAction SilentlyContinue |
          Select-Object -First 1 | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name }
        if (-not $owner) { $owner = 'outro programa' }
        Warn "Neste computador, $owner usa a porta 443 em ::1 (o localhost do IPv6), e https://localhost pode não abrir no navegador."
        if ($Urls.Count -gt 1) { Line 'Use https://127.0.0.1.' } else { Line "Feche $owner, ou desligue o que ele serve na porta 443, e abra https://localhost de novo." }
      }
    } else {
      Ok "$Url responde"
    }

    Title 'Pronto'
    foreach ($url in $Urls) { Line "Loja:    $url" }
    foreach ($url in $Urls) { Line "Painel:  $url/admin" }
    if ($PasswordShown) {
      Line "Senha:   $PasswordShown"
      Line "A senha aparece só agora: guarde num gerenciador de senhas. Ela também fica em $EnvFile."
    }
    if ($Local) {
      Write-Host ''
      Info 'O navegador avisa que a conexão não é particular: o certificado é da própria loja, feito neste computador.'
      Line 'Clique em Avançado e continue.'
      Info 'A loja roda enquanto o Docker Desktop estiver aberto, e só este computador a vê. Para vender, instale num servidor:'
      Line $Guide
    }
    Write-Host ''
    Info 'Entre no painel e siga os primeiros passos:'
    Line '1. Crie seu primeiro produto: preço, chave Pix, vídeo e aulas.'
    Line '2. Conexões: o e-mail primeiro, sem ele quem compra não recebe o acesso. Depois Pix, WhatsApp e Meta.'
    Line '3. Configurações: marca, seu e-mail e seu WhatsApp.'
    Write-Host ''
    Line "Mudou algo? Rode o mesmo comando de novo: o que está em $EnvFile é mantido."
    $global:LASTEXITCODE = 0
  } catch {
    if ("$_" -ne 'LIBREFUNNEL_STOPPED') {
      Write-Host ''
      Write-Host "  x $_" -ForegroundColor Red
      Write-Host "    Rode o instalador de novo. Se repetir, abra uma issue: https://github.com/$Repo/issues"
    }
    $global:LASTEXITCODE = 1
    # Run as a file, the exit code tells the caller; pasted into a window (irm | iex), exit would close it.
    if ($PSCommandPath) { exit 1 }
  }
} @args
