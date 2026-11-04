// Execução de testes Pest/PHPUnit: só `php vendor/bin/{pest,phpunit}` do próprio projeto,
// com caminho confinado à raiz e filtro passado como um único argumento (`--filter=`),
// sem shell. As mensagens TeamCity (`--teamcity`, documentadas pelo PHPUnit e pelo Pest)
// são transmitidas como eventos enquanto o processo roda e também devolvidas completas
// no fim, que é o resultado autoritativo. JUnit e Clover vão para arquivos temporários
// fora do projeto e voltam ao renderer, que os interpreta.
use crate::workspace::{confined, err, Res};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::oneshot,
};

pub type Events = Arc<dyn Fn(Value) + Send + Sync>;
const OUTPUT_LIMIT: usize = 256 * 1024;
const REPORT_LIMIT: u64 = 8 * 1024 * 1024;
const MESSAGES_LIMIT: usize = 8 * 1024 * 1024;
const CONFIG_LIMIT: usize = 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(600);
/// Arquivo do projeto com as configurações de execução salvas (não guarda segredos).
pub const CONFIG_FILE: &str = ".php-ide/run-configurations.json";
/// Opções que o próprio plano controla; aceitá-las do usuário corromperia relatório e eventos.
const RESERVED: [&str; 6] = [
    "--teamcity",
    "--log-junit",
    "--coverage-clover",
    "--colors",
    "--filter",
    "--configuration",
];

#[derive(Default)]
pub struct Tests {
    running: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Debug, Default)]
pub struct Plan {
    pub binary: String,
    pub target: String,
    pub filter: Option<String>,
    pub configuration: Option<String>,
    pub options: Vec<String>,
    pub coverage: Option<String>,
}

/// Valida a requisição do renderer e monta os argumentos sem executar nada.
#[cfg(test)]
pub fn plan(root: &Path, framework: &str, path: &str, filter: &str) -> Res<Plan> {
    plan_with(root, framework, path, filter, &Value::Null)
}

pub fn plan_with(
    root: &Path,
    framework: &str,
    path: &str,
    filter: &str,
    extra: &Value,
) -> Res<Plan> {
    if !["pest", "phpunit"].contains(&framework) {
        return Err("Framework de testes desconhecido".into());
    }
    let binary = format!("vendor/bin/{framework}");
    if !root.join(&binary).exists() || !confined(root, &binary)?.is_file() {
        return Err(format!(
            "{binary} não encontrado. Rode composer install no projeto e tente novamente."
        ));
    }
    let target = confined(root, if path.is_empty() { "." } else { path })?;
    if !(target.is_dir() || target.extension().is_some_and(|e| e == "php")) {
        return Err("Escolha um arquivo .php ou uma pasta de testes".into());
    }
    let target = relative(root, &target)?;
    if filter.len() > 1000 || filter.contains(['\n', '\r', '\0']) {
        return Err("Filtro de teste inválido".into());
    }
    let configuration = match extra["configuration"].as_str().filter(|c| !c.is_empty()) {
        Some(file) => {
            let file = confined(root, file)
                .map_err(|_| format!("Arquivo de configuração não encontrado: {file}"))?;
            if !file.is_file() {
                return Err("O arquivo de configuração alternativo deve ser um arquivo".into());
            }
            Some(relative(root, &file)?)
        }
        None => None,
    };
    let mut options = Vec::new();
    for option in extra["options"].as_array().into_iter().flatten() {
        let option = option.as_str().ok_or("Opção do runner inválida")?;
        if option.is_empty() || option.len() > 1000 || option.contains(['\n', '\r', '\0']) {
            return Err("Opção do runner inválida".into());
        }
        if let Some(reserved) = RESERVED
            .iter()
            .find(|r| option == **r || option.starts_with(&format!("{r}=")))
        {
            return Err(format!(
                "A opção {reserved} é definida pela IDE; use os campos da configuração"
            ));
        }
        options.push(option.to_owned());
    }
    if options.len() > 64 {
        return Err("Opções demais para o runner".into());
    }
    let coverage = match extra["coverage"].as_str() {
        None | Some("") => None,
        Some(engine @ ("xdebug" | "pcov")) => Some(engine.to_owned()),
        Some(_) => return Err("Mecanismo de cobertura desconhecido".into()),
    };
    Ok(Plan {
        binary,
        // Um caminho que começa com "-" seria lido como opção pelo runner.
        target: if target.is_empty() {
            ".".into()
        } else if target.starts_with('-') {
            format!("./{target}")
        } else {
            target
        },
        filter: (!filter.is_empty()).then(|| filter.to_owned()),
        configuration,
        options,
        coverage,
    })
}

fn relative(root: &Path, path: &Path) -> Res<String> {
    Ok(path
        .strip_prefix(root)
        .map_err(err)?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn php() -> String {
    std::env::var("PHP_IDE_PHP_BIN").unwrap_or_else(|_| "php".into())
}

/// Lê o fluxo até o fim mantendo só os últimos `OUTPUT_LIMIT` bytes (o resumo fica no final).
async fn tail(mut reader: impl tokio::io::AsyncRead + Unpin) -> Vec<u8> {
    let mut out = Vec::new();
    let mut chunk = [0u8; 8192];
    while let Ok(n) = reader.read(&mut chunk).await {
        if n == 0 {
            break;
        }
        out.extend_from_slice(&chunk[..n]);
        if out.len() > OUTPUT_LIMIT * 2 {
            out.drain(..out.len() - OUTPUT_LIMIT);
        }
    }
    if out.len() > OUTPUT_LIMIT {
        out.drain(..out.len() - OUTPUT_LIMIT);
    }
    out
}

/// Saída padrão linha a linha: mensagens TeamCity ficam completas (até o limite) e todas
/// as linhas são enviadas em lotes como eventos `test-progress` da execução.
async fn stream(
    reader: impl tokio::io::AsyncRead + Unpin,
    id: String,
    events: Events,
) -> (Vec<u8>, String, bool) {
    let mut lines = BufReader::new(reader);
    let (mut out, mut messages, mut truncated) = (Vec::new(), String::new(), false);
    let mut batch: Vec<String> = Vec::new();
    let mut last = Instant::now();
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match lines.read_until(b'\n', &mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = String::from_utf8_lossy(&buffer)
            .trim_end_matches(['\r', '\n'])
            .to_owned();
        if line.trim_start().starts_with("##teamcity[") {
            if messages.len() + line.len() < MESSAGES_LIMIT {
                messages.push_str(line.trim_start());
                messages.push('\n');
            } else {
                truncated = true;
            }
        } else {
            out.extend_from_slice(line.as_bytes());
            out.push(b'\n');
            if out.len() > OUTPUT_LIMIT * 2 {
                out.drain(..out.len() - OUTPUT_LIMIT);
            }
        }
        batch.push(line);
        if batch.len() >= 200 || last.elapsed() > Duration::from_millis(40) {
            events(json!({"run": id, "lines": std::mem::take(&mut batch)}));
            last = Instant::now();
        }
    }
    if !batch.is_empty() {
        events(json!({"run": id, "lines": batch}));
    }
    if out.len() > OUTPUT_LIMIT {
        out.drain(..out.len() - OUTPUT_LIMIT);
    }
    (out, messages, truncated)
}

fn valid_id(id: &str) -> Res<()> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Identificador de execução inválido".into());
    }
    Ok(())
}

impl Tests {
    pub async fn dispatch(
        &self,
        root: &Path,
        method: &str,
        args: &[Value],
        events: Events,
    ) -> Res<Value> {
        let s = |i: usize| args.get(i).and_then(Value::as_str).unwrap_or("");
        match method {
            "testRun" => {
                valid_id(s(0))?;
                let extra = args.get(4).cloned().unwrap_or(Value::Null);
                self.run(
                    root,
                    s(0),
                    plan_with(root, s(1), s(2), s(3), &extra)?,
                    events,
                )
                .await
            }
            "testCancel" => {
                valid_id(s(0))?;
                if let Some(stop) = self.running.lock().map_err(err)?.remove(s(0)) {
                    let _ = stop.send(());
                }
                Ok(Value::Null)
            }
            "testEnvironment" => environment().await,
            "testConfigRead" => config_read(root),
            "testConfigWrite" => config_write(root, args.first().unwrap_or(&Value::Null)),
            _ => Err("Comando de testes desconhecido".into()),
        }
    }

    async fn run(&self, root: &Path, id: &str, plan: Plan, events: Events) -> Res<Value> {
        let (stop, cancelled) = oneshot::channel();
        {
            let mut running = self.running.lock().map_err(err)?;
            if !running.is_empty() {
                return Err(
                    "Já há testes em execução. Aguarde ou interrompa a execução atual.".into(),
                );
            }
            running.insert(id.to_owned(), stop);
        }
        let result = execute(root, id, &plan, cancelled, events).await;
        if let Ok(mut running) = self.running.lock() {
            running.remove(id);
        }
        result
    }
}

/// Versão do PHP e extensões de cobertura carregadas, sem executar código do projeto.
async fn environment() -> Res<Value> {
    let program = php();
    let probe = |args: &'static [&'static str]| {
        let program = program.clone();
        async move {
            let out = tokio::time::timeout(
                Duration::from_secs(30),
                Command::new(&program)
                    .args(args)
                    .stdin(Stdio::null())
                    .kill_on_drop(true)
                    .output(),
            )
            .await
            .map_err(|_| format!("{program} não respondeu"))?
            .map_err(|e| format!("Não foi possível iniciar {program}: {e}"))?;
            Ok::<String, String>(String::from_utf8_lossy(&out.stdout).to_string())
        }
    };
    let version = probe(&["-r", "echo PHP_VERSION;"]).await?;
    let modules = probe(&["-m"]).await?;
    let has = |name: &str| modules.lines().any(|l| l.trim().eq_ignore_ascii_case(name));
    Ok(json!({
        "php": program,
        "version": version.trim(),
        "xdebug": has("xdebug"),
        "pcov": has("pcov"),
    }))
}

fn config_path(root: &Path) -> Res<PathBuf> {
    let dir = root.join(".php-ide");
    if dir.exists() {
        let real = dir.canonicalize().map_err(err)?;
        if !real.starts_with(root) || !real.is_dir() {
            return Err(".php-ide fora do projeto".into());
        }
    }
    let file = root.join(CONFIG_FILE);
    if file.is_symlink() {
        return Err("O arquivo de configurações não pode ser um link".into());
    }
    Ok(file)
}

fn config_read(root: &Path) -> Res<Value> {
    let file = config_path(root)?;
    match std::fs::metadata(&file) {
        Err(_) => Ok(json!({"version": 1, "configurations": []})),
        Ok(meta) if meta.len() as usize > CONFIG_LIMIT => {
            Err("Arquivo de configurações grande demais".into())
        }
        Ok(_) => {
            let text = std::fs::read_to_string(&file).map_err(err)?;
            serde_json::from_str::<Value>(&text)
                .ok()
                .filter(|v| v["configurations"].is_array())
                .ok_or_else(|| format!("{CONFIG_FILE} inválido: corrija ou remova o arquivo"))
        }
    }
}

fn config_write(root: &Path, value: &Value) -> Res<Value> {
    if !value["configurations"].is_array() {
        return Err("Configurações inválidas".into());
    }
    let text = serde_json::to_string_pretty(value).map_err(err)?;
    if text.len() > CONFIG_LIMIT {
        return Err("Configurações grandes demais".into());
    }
    let file = config_path(root)?;
    std::fs::create_dir_all(file.parent().ok_or("caminho inválido")?).map_err(err)?;
    // Escrita atômica: um arquivo parcial nunca substitui as configurações salvas.
    let temp = file.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temp, text + "\n").map_err(err)?;
    std::fs::rename(&temp, &file).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        err(e)
    })?;
    Ok(Value::Null)
}

fn report(path: &Path) -> Option<String> {
    let text = match std::fs::metadata(path) {
        Ok(meta) if meta.len() <= REPORT_LIMIT => std::fs::read_to_string(path).ok(),
        _ => None,
    };
    let _ = std::fs::remove_file(path);
    text
}

async fn execute(
    root: &Path,
    id: &str,
    plan: &Plan,
    cancelled: oneshot::Receiver<()>,
    events: Events,
) -> Res<Value> {
    let temp = std::env::temp_dir();
    let junit: PathBuf = temp.join(format!("php-ide-junit-{}.xml", uuid::Uuid::new_v4()));
    let clover: PathBuf = temp.join(format!("php-ide-clover-{}.xml", uuid::Uuid::new_v4()));
    let mut args = Vec::new();
    if plan.coverage.as_deref() == Some("pcov") {
        args.extend(["-d".to_owned(), "pcov.enabled=1".to_owned()]);
    }
    args.extend([plan.binary.clone(), plan.target.clone()]);
    if let Some(config) = &plan.configuration {
        args.push(format!("--configuration={config}"));
    }
    if let Some(filter) = &plan.filter {
        args.push(format!("--filter={filter}"));
    }
    args.extend(plan.options.iter().cloned());
    let program = php();
    let mut shown = args.clone();
    if plan.coverage.is_some() {
        shown.push("--coverage-clover".into());
        shown.push("<relatório temporário>".into());
        args.extend([
            "--coverage-clover".into(),
            clover.to_string_lossy().to_string(),
        ]);
    }
    let command = format!("{program} {}", shown.join(" "));
    args.extend([
        "--teamcity".into(),
        "--log-junit".into(),
        junit.to_string_lossy().to_string(),
        "--colors=never".into(),
    ]);
    let started = Instant::now();
    let mut process = Command::new(&program);
    process
        .args(&args)
        .current_dir(root)
        .env("NO_COLOR", "1")
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if plan.coverage.as_deref() == Some("xdebug") {
        process.env("XDEBUG_MODE", "coverage");
    }
    let mut child = process.spawn().map_err(|e| {
        format!(
            "Não foi possível iniciar {program}: {e}. Instale PHP 8.2+ ou defina PHP_IDE_PHP_BIN."
        )
    })?;
    events(json!({"run": id, "command": command}));
    let stdout = tokio::spawn(stream(
        child.stdout.take().ok_or("stdout indisponível")?,
        id.to_owned(),
        events.clone(),
    ));
    let stderr = tokio::spawn(tail(child.stderr.take().ok_or("stderr indisponível")?));
    let (code, stopped, timed_out) = tokio::select! {
        status = child.wait() => (status.map_err(err)?.code(), false, false),
        _ = cancelled => { let _ = child.kill().await; (None, true, false) }
        _ = tokio::time::sleep(TIMEOUT) => { let _ = child.kill().await; (None, false, true) }
    };
    let (mut output, messages, truncated) = stdout.await.unwrap_or_default();
    let errors = stderr.await.unwrap_or_default();
    output.extend(&errors);
    Ok(json!({
        "command": command,
        "exitCode": code,
        "cancelled": stopped,
        "timedOut": timed_out,
        "durationMs": started.elapsed().as_millis() as u64,
        "junit": report(&junit),
        "clover": if plan.coverage.is_some() { report(&clover).map(Value::String).unwrap_or(Value::Null) } else { let _ = std::fs::remove_file(&clover); Value::Null },
        "teamcity": messages,
        "teamcityTruncated": truncated,
        "output": String::from_utf8_lossy(&output),
        "stderr": String::from_utf8_lossy(&errors),
    }))
}

#[cfg(test)]
mod test {
    use super::*;

    fn quiet() -> Events {
        Arc::new(|_| {})
    }

    fn project() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("vendor/bin")).unwrap();
        std::fs::create_dir_all(root.join("tests/Unit")).unwrap();
        std::fs::write(root.join("tests/Unit/ExampleTest.php"), "<?php\n").unwrap();
        (dir, root)
    }

    #[test]
    fn plan_rejeita_entradas_fora_do_contrato() {
        let (_dir, root) = project();
        assert!(plan(&root, "phpunit", "tests", "")
            .unwrap_err()
            .contains("composer install"));
        std::fs::write(root.join("vendor/bin/phpunit"), "<?php\n").unwrap();
        assert!(plan(&root, "sh", "tests", "").is_err());
        assert!(plan(&root, "phpunit", "../", "").is_err());
        assert!(plan(&root, "phpunit", "/etc/passwd", "").is_err());
        assert!(
            plan(&root, "phpunit", "vendor/bin/phpunit", "").is_err(),
            "só .php ou pasta"
        );
        assert!(plan(&root, "phpunit", "tests", "a\nb").is_err());
        let ok = plan(&root, "phpunit", "tests/Unit/ExampleTest.php", "/::testA$/").unwrap();
        assert_eq!(ok.target, "tests/Unit/ExampleTest.php");
        assert_eq!(ok.filter.as_deref(), Some("/::testA$/"));
        assert_eq!(plan(&root, "phpunit", "", "").unwrap().target, ".");
    }

    #[test]
    fn binario_fora_do_projeto_e_recusado() {
        let (_dir, root) = project();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("pest"), "<?php\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path().join("pest"), root.join("vendor/bin/pest"))
            .unwrap();
        #[cfg(unix)]
        assert!(plan(&root, "pest", "tests", "").is_err());
    }

    /// Runner falso em PHP: grava os argumentos recebidos como relatório JUnit.
    #[tokio::test]
    async fn executa_sem_shell_e_devolve_junit() {
        if std::process::Command::new(php())
            .arg("-v")
            .output()
            .is_err()
        {
            eprintln!("PHP indisponível; teste ignorado");
            return;
        }
        let (_dir, root) = project();
        std::fs::write(
            root.join("vendor/bin/phpunit"),
            "<?php\n$i = array_search('--log-junit', $argv);\nfile_put_contents($argv[$i + 1], json_encode(array_slice($argv, 1)));\necho \"saida\\n\";\nexit(1);\n",
        )
        .unwrap();
        let tests = Tests::default();
        let filter = "x; rm -rf / $(touch pwned)";
        let out = tests
            .dispatch(
                &root,
                "testRun",
                &[
                    json!("run-1"),
                    json!("phpunit"),
                    json!("tests/Unit/ExampleTest.php"),
                    json!(filter),
                ],
                quiet(),
            )
            .await
            .unwrap();
        assert_eq!(out["exitCode"], 1);
        assert!(out["output"].as_str().unwrap().contains("saida"));
        let args: Vec<String> = serde_json::from_str(out["junit"].as_str().unwrap()).unwrap();
        assert_eq!(args[0], "tests/Unit/ExampleTest.php");
        assert_eq!(args[1], format!("--filter={filter}"));
        assert!(!root.join("pwned").exists());
        assert!(tests.running.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn cancelamento_interrompe_o_processo() {
        if std::process::Command::new(php())
            .arg("-v")
            .output()
            .is_err()
        {
            return;
        }
        let (_dir, root) = project();
        std::fs::write(root.join("vendor/bin/pest"), "<?php\nsleep(30);\n").unwrap();
        let tests = std::sync::Arc::new(Tests::default());
        let runner = tests.clone();
        let root2 = root.clone();
        let job = tokio::spawn(async move {
            runner
                .dispatch(
                    &root2,
                    "testRun",
                    &[json!("run-2"), json!("pest"), json!("tests"), json!("")],
                    quiet(),
                )
                .await
        });
        while tests.running.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let busy = tests
            .dispatch(
                &root,
                "testRun",
                &[json!("run-3"), json!("pest"), json!("tests"), json!("")],
                quiet(),
            )
            .await;
        assert!(busy.unwrap_err().contains("em execução"));
        tests
            .dispatch(&root, "testCancel", &[json!("run-2")], quiet())
            .await
            .unwrap();
        let out = tokio::time::timeout(Duration::from_secs(10), job)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(out["cancelled"], true);
        assert!(out["junit"].is_null());
    }

    #[test]
    fn opcoes_configuracao_e_cobertura_sao_validadas() {
        let (_dir, root) = project();
        std::fs::write(root.join("vendor/bin/phpunit"), "<?php\n").unwrap();
        std::fs::write(root.join("phpunit.ci.xml"), "<phpunit/>").unwrap();
        let extra = json!({"configuration": "phpunit.ci.xml", "options": ["--stop-on-failure", "--group=fast"], "coverage": "pcov"});
        let ok = plan_with(&root, "phpunit", "tests", "", &extra).unwrap();
        assert_eq!(ok.configuration.as_deref(), Some("phpunit.ci.xml"));
        assert_eq!(ok.options, ["--stop-on-failure", "--group=fast"]);
        assert_eq!(ok.coverage.as_deref(), Some("pcov"));
        for bad in [
            json!({"options": ["--log-junit=/tmp/x"]}),
            json!({"options": ["--teamcity"]}),
            json!({"options": ["a\nb"]}),
            json!({"configuration": "../outside.xml"}),
            json!({"configuration": "tests"}),
            json!({"coverage": "phpdbg"}),
        ] {
            assert!(
                plan_with(&root, "phpunit", "tests", "", &bad).is_err(),
                "{bad}"
            );
        }
        std::fs::write(root.join("-x.php"), "<?php\n").unwrap();
        assert_eq!(
            plan(&root, "phpunit", "-x.php", "").unwrap().target,
            "./-x.php"
        );
    }

    #[test]
    fn configuracoes_sao_salvas_no_projeto() {
        let (_dir, root) = project();
        assert_eq!(config_read(&root).unwrap()["configurations"], json!([]));
        let value = json!({"version": 1, "selected": "a", "configurations": [{"id": "a", "name": "CalculatorTest"}]});
        config_write(&root, &value).unwrap();
        assert_eq!(config_read(&root).unwrap(), value);
        assert!(config_write(&root, &json!({"x": 1})).is_err());
        std::fs::write(root.join(CONFIG_FILE), "{quebrado").unwrap();
        assert!(config_read(&root).unwrap_err().contains("inválido"));
        let leftovers = std::fs::read_dir(root.join(".php-ide")).unwrap().count();
        assert_eq!(leftovers, 1, "sem temporários");
    }

    /// Runner falso que imprime mensagens TeamCity: eventos chegam durante a execução.
    #[tokio::test]
    async fn transmite_teamcity_e_devolve_relatorios() {
        if std::process::Command::new(php())
            .arg("-v")
            .output()
            .is_err()
        {
            return;
        }
        let (_dir, root) = project();
        std::fs::write(
            root.join("vendor/bin/phpunit"),
            "<?php\n$i = array_search('--coverage-clover', $argv);\nif ($i) file_put_contents($argv[$i + 1], '<coverage/>');\necho \"##teamcity[testStarted name='a']\\n\";\necho \"texto\\n\";\necho \"##teamcity[testFinished name='a' duration='1']\\n\";\nfwrite(STDERR, \"aviso\\n\");\n",
        )
        .unwrap();
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let sink = seen.clone();
        let events: Events = Arc::new(move |e| sink.lock().unwrap().push(e));
        let out = Tests::default()
            .dispatch(
                &root,
                "testRun",
                &[
                    json!("run-4"),
                    json!("phpunit"),
                    json!("tests"),
                    json!(""),
                    json!({"coverage": "xdebug"}),
                ],
                events,
            )
            .await
            .unwrap();
        assert_eq!(
            out["teamcity"],
            "##teamcity[testStarted name='a']\n##teamcity[testFinished name='a' duration='1']\n"
        );
        assert_eq!(out["clover"], "<coverage/>");
        assert!(out["output"].as_str().unwrap().contains("texto"));
        assert_eq!(out["stderr"], "aviso\n");
        assert!(out["command"]
            .as_str()
            .unwrap()
            .contains("--coverage-clover <relatório temporário>"));
        let lines: Vec<String> = seen
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e["run"] == "run-4")
            .flat_map(|e| e["lines"].as_array().cloned().unwrap_or_default())
            .map(|l| l.as_str().unwrap().to_owned())
            .collect();
        assert_eq!(lines.len(), 3);
        assert!(seen
            .lock()
            .unwrap()
            .iter()
            .any(|e| e["command"].is_string()));
    }

    #[tokio::test]
    async fn ambiente_informa_cobertura() {
        if std::process::Command::new(php())
            .arg("-v")
            .output()
            .is_err()
        {
            return;
        }
        let env = environment().await.unwrap();
        assert!(env["version"].as_str().unwrap().starts_with('8'));
        assert!(env["xdebug"].is_boolean() && env["pcov"].is_boolean());
    }
}
