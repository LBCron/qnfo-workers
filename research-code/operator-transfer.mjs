function finiteVector(value, label) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new TypeError(label + " must be an array or typed array");
  }
  const vector = Array.from(value);
  if (!vector.length || vector.some((item) => !Number.isFinite(item))) {
    throw new TypeError(label + " must contain finite values");
  }
  return vector;
}

/** Centered one-dimensional convolution with zero padding and an odd kernel. */
export function convolve1d(input, kernel) {
  const signal = finiteVector(input, "input");
  const weights = finiteVector(kernel, "kernel");
  if (weights.length % 2 !== 1) throw new RangeError("kernel length must be odd");
  const center = Math.floor(weights.length / 2);
  return signal.map((_, index) => {
    let value = 0;
    for (let k = 0; k < weights.length; k++) {
      const sample = index + center - k;
      if (sample >= 0 && sample < signal.length) value += signal[sample] * weights[k];
    }
    return value;
  });
}

function predict(strategy, input, domain, expectedLength, label) {
  const result = finiteVector(strategy(input, domain), label);
  if (result.length !== expectedLength) {
    throw new RangeError(label + " length must match its target");
  }
  return result;
}

function elapsed(start) {
  return Math.max(0, performance.now() - start);
}

/**
 * Compares a shared strategy with one supplied baseline per domain.
 * Error is macro-averaged by domain; runtime fields are raw elapsed milliseconds.
 * Strategies receive isolated input copies and should be deterministic.
 */
export function evaluateOperatorTransfer({ domains, transfer, domainSpecific }) {
  if (!Array.isArray(domains) || !domains.length) throw new TypeError("domains must be a non-empty array");
  if (typeof transfer !== "function") throw new TypeError("transfer must be a function");
  if (!domainSpecific || typeof domainSpecific !== "object") {
    throw new TypeError("domainSpecific must map domain names to functions");
  }

  const seen = new Set();
  const results = domains.map((domain) => {
    if (!domain || typeof domain.name !== "string" || !domain.name.trim() || seen.has(domain.name)) {
      throw new TypeError("domain names must be non-empty and unique");
    }
    seen.add(domain.name);
    if (!Array.isArray(domain.samples) || !domain.samples.length) {
      throw new TypeError("each domain must have samples");
    }
    const baseline = Object.hasOwn(domainSpecific, domain.name) ? domainSpecific[domain.name] : null;
    if (typeof baseline !== "function") {
      throw new TypeError("missing domain-specific baseline for " + domain.name);
    }

    let transferSquaredError = 0, baselineSquaredError = 0;
    let transferMs = 0, domainSpecificMs = 0, valueCount = 0;
    for (const sample of domain.samples) {
      const input = finiteVector(sample && sample.input, "sample input");
      const target = finiteVector(sample && sample.target, "sample target");
      if (input.length !== target.length) throw new RangeError("input length must match target length");

      let start = performance.now();
      const transferred = predict(transfer, input.slice(), domain.name, target.length, "transfer output");
      transferMs += elapsed(start);

      start = performance.now();
      const specialized = predict(baseline, input.slice(), domain.name, target.length, "domain-specific output");
      domainSpecificMs += elapsed(start);

      for (let i = 0; i < target.length; i++) {
        transferSquaredError += (transferred[i] - target[i]) ** 2;
        baselineSquaredError += (specialized[i] - target[i]) ** 2;
      }
      valueCount += target.length;
    }

    const transferMse = transferSquaredError / valueCount;
    const domainSpecificMse = baselineSquaredError / valueCount;
    const absoluteErrorGain = domainSpecificMse - transferMse;
    return {
      name: domain.name,
      samples: domain.samples.length,
      transferMse,
      domainSpecificMse,
      absoluteErrorGain,
      relativeErrorGain: domainSpecificMse === 0 ? null : absoluteErrorGain / domainSpecificMse,
      transferMs,
      domainSpecificMs,
      runtimeRatio: domainSpecificMs === 0 ? null : transferMs / domainSpecificMs
    };
  });

  const mean = (key) => results.reduce((sum, result) => sum + result[key], 0) / results.length;
  const transferMse = mean("transferMse");
  const domainSpecificMse = mean("domainSpecificMse");
  const absoluteErrorGain = domainSpecificMse - transferMse;
  return {
    domains: results,
    transferMse,
    domainSpecificMse,
    absoluteErrorGain,
    relativeErrorGain: domainSpecificMse === 0 ? null : absoluteErrorGain / domainSpecificMse,
    transferWinsDomains: results.filter((result) => result.absoluteErrorGain > 0).length
  };
}
