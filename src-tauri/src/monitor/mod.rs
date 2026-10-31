//! Minimal server monitoring: CPU, memory, disk, network and GPU, read over
//! the existing SSH Session by running a fixed read-only script.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::ssh::SshManager;

const SCRIPT_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_DISKS: usize = 6;

/// Run with `sh -s` so the remote login shell (fish, csh, ...) never parses
/// it. Every section is introduced by an `@@name` line.
pub const SCRIPT: &str = r#"
echo @@cpu; head -n 1 /proc/stat 2>/dev/null
echo @@cores; grep -c '^processor' /proc/cpuinfo 2>/dev/null
echo @@load; cat /proc/loadavg 2>/dev/null
echo @@mem; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null
echo @@disk; df -kPT 2>/dev/null | tail -n +2
echo @@net; cat /proc/net/dev 2>/dev/null
echo @@gpu; nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null
echo @@uptime; cut -d' ' -f1 /proc/uptime 2>/dev/null
echo @@end
"#;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RawSample {
    cpu: Option<CpuTimes>,
    cores: Option<u32>,
    load: Option<[f64; 3]>,
    memory: Option<MemoryUsage>,
    disks: Vec<DiskUsage>,
    network: Option<NetworkTotals>,
    gpus: Vec<GpuUsage>,
    uptime_secs: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct CpuTimes {
    total: u64,
    idle: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct NetworkTotals {
    rx_bytes: u64,
    tx_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MemoryUsage {
    pub total_kib: u64,
    pub used_kib: u64,
    pub swap_total_kib: u64,
    pub swap_used_kib: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiskUsage {
    pub mount: String,
    pub filesystem: String,
    pub size_kib: u64,
    pub used_kib: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GpuUsage {
    pub name: String,
    pub utilization_percent: f64,
    pub memory_used_mib: f64,
    pub memory_total_mib: f64,
    pub temperature_c: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NetworkRate {
    pub rx_total_bytes: u64,
    pub tx_total_bytes: u64,
    /// `None` until a second sample exists (or after a counter reset).
    pub rx_bytes_per_sec: Option<f64>,
    pub tx_bytes_per_sec: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MonitorSample {
    /// False when the server exposes no `/proc` (not Linux).
    pub supported: bool,
    /// `None` on the first sample: CPU load is a difference between two.
    pub cpu_percent: Option<f64>,
    pub cores: Option<u32>,
    pub load: Option<[f64; 3]>,
    pub memory: Option<MemoryUsage>,
    pub disks: Vec<DiskUsage>,
    pub network: Option<NetworkRate>,
    pub gpus: Vec<GpuUsage>,
    pub uptime_secs: Option<u64>,
}

fn sections(output: &str) -> HashMap<&str, Vec<&str>> {
    let mut result: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut current: Option<&str> = None;

    for line in output.lines() {
        if let Some(name) = line.strip_prefix("@@") {
            current = Some(name.trim());
            result.entry(name.trim()).or_default();
        } else if let Some(name) = current {
            if !line.trim().is_empty() {
                result.entry(name).or_default().push(line);
            }
        }
    }

    result
}

fn parse_cpu(lines: &[&str]) -> Option<CpuTimes> {
    let line = lines.first()?;
    let mut fields = line.split_whitespace();
    if fields.next()? != "cpu" {
        return None;
    }

    // user nice system idle iowait irq softirq steal
    let values: Vec<u64> = fields.take(8).filter_map(|value| value.parse().ok()).collect();
    if values.len() < 4 {
        return None;
    }

    Some(CpuTimes {
        total: values.iter().sum(),
        idle: values[3] + values.get(4).copied().unwrap_or(0),
    })
}

fn parse_load(lines: &[&str]) -> Option<[f64; 3]> {
    let mut fields = lines.first()?.split_whitespace();
    Some([
        fields.next()?.parse().ok()?,
        fields.next()?.parse().ok()?,
        fields.next()?.parse().ok()?,
    ])
}

fn parse_memory(lines: &[&str]) -> Option<MemoryUsage> {
    let value = |key: &str| -> Option<u64> {
        lines.iter().find_map(|line| {
            let (name, rest) = line.split_once(':')?;
            (name == key).then(|| rest.split_whitespace().next()?.parse().ok())?
        })
    };

    let total = value("MemTotal")?;
    let available = value("MemAvailable").unwrap_or(0);
    let swap_total = value("SwapTotal").unwrap_or(0);
    let swap_free = value("SwapFree").unwrap_or(0);

    Some(MemoryUsage {
        total_kib: total,
        used_kib: total.saturating_sub(available),
        swap_total_kib: swap_total,
        swap_used_kib: swap_total.saturating_sub(swap_free),
    })
}

fn parse_disks(lines: &[&str]) -> Vec<DiskUsage> {
    let mut seen = Vec::new();
    let mut disks = Vec::new();

    for line in lines {
        // Filesystem Type 1K-blocks Used Available Capacity Mounted-on
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 7 {
            continue;
        }

        // Real devices only: tmpfs, overlay and friends are not disks.
        let filesystem = fields[0];
        if !filesystem.starts_with('/') || seen.contains(&filesystem) {
            continue;
        }

        let (Ok(size), Ok(used)) = (fields[2].parse::<u64>(), fields[3].parse::<u64>()) else {
            continue;
        };
        if size == 0 {
            continue;
        }

        seen.push(filesystem);
        disks.push(DiskUsage {
            mount: fields[6..].join(" "),
            filesystem: filesystem.to_string(),
            size_kib: size,
            used_kib: used,
        });
    }

    disks.truncate(MAX_DISKS);
    disks
}

fn parse_network(lines: &[&str]) -> Option<NetworkTotals> {
    let mut rx = 0u64;
    let mut tx = 0u64;
    let mut any = false;

    for line in lines {
        let Some((name, counters)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        // Loopback and virtual bridges would double-count traffic.
        if name == "lo"
            || name.starts_with("veth")
            || name.starts_with("docker")
            || name.starts_with("br-")
            || name.starts_with("virbr")
        {
            continue;
        }

        let fields: Vec<u64> = counters
            .split_whitespace()
            .filter_map(|value| value.parse().ok())
            .collect();
        // Receive bytes is field 0 and transmit bytes field 8.
        if fields.len() >= 9 {
            rx = rx.saturating_add(fields[0]);
            tx = tx.saturating_add(fields[8]);
            any = true;
        }
    }

    any.then_some(NetworkTotals {
        rx_bytes: rx,
        tx_bytes: tx,
    })
}

fn parse_gpus(lines: &[&str]) -> Vec<GpuUsage> {
    lines
        .iter()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(',').map(str::trim).collect();
            if fields.len() < 4 {
                return None;
            }
            Some(GpuUsage {
                name: fields[0].to_string(),
                utilization_percent: fields[1].parse().ok()?,
                memory_used_mib: fields[2].parse().ok()?,
                memory_total_mib: fields[3].parse().ok()?,
                temperature_c: fields.get(4).and_then(|value| value.parse().ok()),
            })
        })
        .collect()
}

pub fn parse(output: &str) -> RawSample {
    let sections = sections(output);
    let lines = |name: &str| sections.get(name).map(Vec::as_slice).unwrap_or(&[]);

    RawSample {
        cpu: parse_cpu(lines("cpu")),
        cores: lines("cores").first().and_then(|line| line.trim().parse().ok()),
        load: parse_load(lines("load")),
        memory: parse_memory(lines("mem")),
        disks: parse_disks(lines("disk")),
        network: parse_network(lines("net")),
        gpus: parse_gpus(lines("gpu")),
        uptime_secs: lines("uptime")
            .first()
            .and_then(|line| line.trim().parse::<f64>().ok())
            .map(|seconds| seconds as u64),
    }
}

/// Turns two raw samples into percentages and rates.
pub fn compute(
    previous: Option<(&RawSample, Duration)>,
    current: &RawSample,
) -> MonitorSample {
    let cpu_percent = previous.and_then(|(before, _)| {
        let (before, now) = (before.cpu?, current.cpu?);
        let total = now.total.checked_sub(before.total)?;
        let idle = now.idle.checked_sub(before.idle)?;
        (total > 0).then(|| ((total - idle.min(total)) as f64 / total as f64 * 100.0).clamp(0.0, 100.0))
    });

    let network = current.network.map(|now| {
        let rate = |before: Option<u64>, after: u64, elapsed: Duration| {
            let seconds = elapsed.as_secs_f64();
            (seconds > 0.0)
                .then(|| after.checked_sub(before?).map(|delta| delta as f64 / seconds))?
        };
        let before = previous.and_then(|(sample, elapsed)| Some((sample.network?, elapsed)));

        NetworkRate {
            rx_total_bytes: now.rx_bytes,
            tx_total_bytes: now.tx_bytes,
            rx_bytes_per_sec: before.and_then(|(b, e)| rate(Some(b.rx_bytes), now.rx_bytes, e)),
            tx_bytes_per_sec: before.and_then(|(b, e)| rate(Some(b.tx_bytes), now.tx_bytes, e)),
        }
    });

    MonitorSample {
        supported: current.cpu.is_some() || current.memory.is_some(),
        cpu_percent,
        cores: current.cores,
        load: current.load,
        memory: current.memory.clone(),
        disks: current.disks.clone(),
        network,
        gpus: current.gpus.clone(),
        uptime_secs: current.uptime_secs,
    }
}

/// Keeps the previous sample of each Session so rates can be computed.
#[derive(Default)]
pub struct MonitorManager {
    previous: Mutex<HashMap<Uuid, (Instant, RawSample)>>,
}

impl MonitorManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn sample(
        &self,
        ssh: &SshManager,
        session_id: Uuid,
    ) -> Result<MonitorSample, AppError> {
        let output = ssh
            .run_script(session_id, "sh -s", SCRIPT, SCRIPT_TIMEOUT)
            .await?;
        let now = Instant::now();
        let current = parse(&output);

        let mut previous = self
            .previous
            .lock()
            .map_err(|_| AppError::Internal("monitor state is unavailable".into()))?;
        let sample = compute(
            previous
                .get(&session_id)
                .map(|(taken, raw)| (raw, now.duration_since(*taken))),
            &current,
        );
        previous.insert(session_id, (now, current));

        Ok(sample)
    }

    pub fn forget(&self, session_id: Uuid) {
        if let Ok(mut previous) = self.previous.lock() {
            previous.remove(&session_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output(cpu: &str, rx: u64, tx: u64) -> String {
        format!(
            "@@cpu\n{cpu}\n@@cores\n8\n@@load\n0.52 0.41 0.30 1/345 12345\n@@mem\nMemTotal:       16000000 kB\nMemAvailable:    4000000 kB\nSwapTotal:       2000000 kB\nSwapFree:        1500000 kB\n@@disk\n/dev/nvme0n1p2 ext4 100000000 40000000 55000000 43% /\ntmpfs tmpfs 1000 10 990 1% /run\n/dev/nvme0n1p2 ext4 100000000 40000000 55000000 43% /var/lib/docker\n/dev/sda1 xfs 500000000 250000000 250000000 50% /mnt/data disk\noverlay overlay 100 1 99 1% /var/lib/docker/overlay2/x\n@@net\nInter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n    lo: 999999    10    0    0    0     0          0         0   999999    10    0    0    0     0       0          0\n  eth0: {rx}    10    0    0    0     0          0         0   {tx}    10    0    0    0     0       0          0\ndocker0: 5000 1 0 0 0 0 0 0 5000 1 0 0 0 0 0 0\n@@gpu\nNVIDIA GeForce RTX 4090, 37, 2048, 24564, 51\n@@uptime\n90061.52\n@@end\n"
        )
    }

    const CPU_A: &str = "cpu  1000 0 500 8000 500 0 0 0 0 0";
    // Against CPU_A: 300 more busy and 900 more idle jiffies.
const CPU_B: &str = "cpu  1300 0 500 8800 600 0 0 0 0 0";

    #[test]
    fn parses_every_section() {
        let raw = parse(&output(CPU_A, 1_000_000, 500_000));

        assert_eq!(raw.cpu, Some(CpuTimes { total: 10000, idle: 8500 }));
        assert_eq!(raw.cores, Some(8));
        assert_eq!(raw.load, Some([0.52, 0.41, 0.30]));
        assert_eq!(raw.uptime_secs, Some(90061));

        let memory = raw.memory.unwrap();
        assert_eq!(memory.total_kib, 16_000_000);
        assert_eq!(memory.used_kib, 12_000_000);
        assert_eq!(memory.swap_used_kib, 500_000);

        assert_eq!(
            raw.network,
            Some(NetworkTotals { rx_bytes: 1_000_000, tx_bytes: 500_000 })
        );

        assert_eq!(raw.gpus.len(), 1);
        assert_eq!(raw.gpus[0].name, "NVIDIA GeForce RTX 4090");
        assert_eq!(raw.gpus[0].utilization_percent, 37.0);
        assert_eq!(raw.gpus[0].memory_total_mib, 24564.0);
        assert_eq!(raw.gpus[0].temperature_c, Some(51.0));
    }

    #[test]
    fn disks_keep_real_devices_once_and_keep_mounts_with_spaces() {
        let raw = parse(&output(CPU_A, 0, 0));
        let mounts: Vec<&str> = raw.disks.iter().map(|disk| disk.mount.as_str()).collect();

        assert_eq!(mounts, vec!["/", "/mnt/data disk"]);
        assert_eq!(raw.disks[1].filesystem, "/dev/sda1");
        assert_eq!(raw.disks[1].used_kib, 250_000_000);
    }

    #[test]
    fn missing_sections_are_simply_absent() {
        // A server without /proc or nvidia-smi still yields a sample.
        let raw = parse("@@cpu\n@@mem\n@@gpu\n@@end\n");

        assert_eq!(raw, RawSample::default());
        assert!(!compute(None, &raw).supported);
    }

    #[test]
    fn cpu_percent_needs_two_samples() {
        let first = parse(&output(CPU_A, 0, 0));
        let second = parse(&output(CPU_B, 0, 0));

        assert_eq!(compute(None, &first).cpu_percent, None);

        // Busy time grew by 300 of 1200 jiffies, 25%.
        let sample = compute(Some((&first, Duration::from_secs(2))), &second);
        assert_eq!(sample.cpu_percent, Some(25.0));
        assert!(sample.supported);
    }

    #[test]
    fn network_rate_is_bytes_over_seconds() {
        let first = parse(&output(CPU_A, 1_000_000, 500_000));
        let second = parse(&output(CPU_B, 3_000_000, 700_000));

        let sample = compute(Some((&first, Duration::from_secs(2))), &second);
        let network = sample.network.unwrap();

        assert_eq!(network.rx_bytes_per_sec, Some(1_000_000.0));
        assert_eq!(network.tx_bytes_per_sec, Some(100_000.0));
        assert_eq!(network.rx_total_bytes, 3_000_000);
    }

    #[test]
    fn a_counter_that_went_backwards_has_no_rate() {
        let first = parse(&output(CPU_A, 5_000_000, 500_000));
        let second = parse(&output(CPU_B, 1_000, 700_000));

        let network = compute(Some((&first, Duration::from_secs(2))), &second)
            .network
            .unwrap();

        assert_eq!(network.rx_bytes_per_sec, None);
        assert_eq!(network.tx_bytes_per_sec, Some(100_000.0));
    }

    #[test]
    fn a_cpu_counter_that_went_backwards_has_no_percentage() {
        let first = parse(&output(CPU_B, 0, 0));
        let second = parse(&output(CPU_A, 0, 0));

        assert_eq!(
            compute(Some((&first, Duration::from_secs(2))), &second).cpu_percent,
            None
        );
    }

    #[test]
    fn the_script_only_reads() {
        for forbidden in ["rm ", "kill", ">", "sudo", "mv ", "chmod", "curl", "wget"] {
            let without_redirects = SCRIPT.replace("2>/dev/null", "");
            assert!(
                !without_redirects.contains(forbidden),
                "script must not contain {forbidden:?}"
            );
        }
    }
}
