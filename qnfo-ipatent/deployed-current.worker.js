var __defProp = Object.defineProperty;
var VERSION = "3.20.1";
// 3.19.1 BP26-NO-TRACKING-1 (2026-10-26, agent_issues 1000345, pillar security; GDPR and ePrivacy: only strictly necessary cookies): the A/B split no longer sets the cookie ipatent_ab, which is not strictly necessary. Each human page load draws its own arm at random (same share, same redirect), so the two variants are compared per page view and per draft, never per visitor; a browser that still holds the retired cookie is told once to drop it. 3.19.0 BP26-AI-LABEL-1 (2026-10-26, pillar reach; EU AI Act Art. 50(1), applicable since 2026-08-02): the landing page states before first use that iPatent is an AI system and that an AI language model writes the draft; the limits list says so too. // 3.18.0 WEBMCP-FLEET-1: expose the generated tool bridge on the rendered page. // 3.17.2 WORKERS-BP-LOGGING-qnfo-ipatent-1 (2026-10-14, agent_issues 2535, child of 2342, pillar autonomy): the 6 server-side swallowed catches log (the 2 browser-script hits are allowlisted) as a structured console.error (worker, where, error); control flow unchanged. // 3.17.1: the version line only (version-bump-guard compares each push; no behaviour change). 3.17.0 IPATENT-UI-OVERHAUL-1 step 3 and IPATENT-COST-PER-DRAFT-1 (2026-10-12, agent_issues 2049, 2055, 1903, 1779; pillars reach and cost; owner: the page must read as a serious one-stop tool for individual inventors, built on what the invention is, what it does and how it works): the drafting page is redesigned for both variants (one HTML, every id, route and function kept): a drawing-sheet system (Archivo for the interface, Source Serif 4 for the document, one action colour, green/amber/red only for support states), a figure of what happens to a description, the description prompt split into what it is / what it does / how it works, the step rail beside the form and result on wide screens and a sticky strip on phones, samples moved behind a disclosure, a limits section (not legal advice, files nothing, no prior-art search, does not supply the invention), a guide index, a skip link, labelled status regions and sentence-case text; /guide, /guide/* and /example take the same tokens. New: GET /api/cost serves the measured model cost per completed draft from qnfo-audit ai_call_counters (neurons, tokens, USD at the published neuron rate; no price is set), every mechanism-card model call is metered as purpose mechanism and every completed draft as purpose draft-done. A draft requested by an automated client is stored as status automated and left out of the drafts and drafters that /api/metrics reports (DRAFT-ROW-AUTOMATED-1). Standards: the admin token is compared in constant time and the benchmark source probe reads a bounded body. Tests: landing.test.mjs, cost.test.mjs. // 3.16.0 IPATENT-GROUND-1 (2026-10-10, pillar core, owner directive: drafts state only what the inventor supplied, no example nouns in prompts, fail closed): the disclosure prompt takes its Background only from the inventor\'s text and labels any statement about existing approaches as unverified; the retrieved example disclosures are reduced to section headings (no titles, fields or text); the inventor declaration is a fixed text with no statement of novelty; the claim list no longer forces categories the description does not support; after drafting, a Background sentence the description does not support is removed, a sentence or claim reciting a figure, DOI, link or citation the inventor did not give is removed (a claim takes its dependents with it) and every removal is listed under SUPPORT GAPS. Tests: ground.test.mjs. // 3.15.0 AB-SPLIT-V2-1 (IPATENT-UI-OVERHAUL-1 step 2, agent_issues 2049, 2026-10-09, pillar reach): a human GET / without a v parameter is assigned once to arm 1 (default page) or arm 2 (302 to ?v=2) by the cookie ipatent_ab (arm number only, 30 days; share = qnfo-audit ops_config ipatent_v2_share, cached 5 min, "0" turns it off without a deploy; env IPATENT_V2_SHARE overrides), so both variants get human traffic and step 2 can compare drafts per visit; crawlers, HEAD and an explicit ?v= are unchanged. 3.14.0 GUIDED-FLOW-1 (IPATENT-UI-OVERHAUL-1 step 1, agent_issues 2049, 2026-10-08, pillar reach): the ?v=2 variant is a guided flow: a step rail (describe, mechanism, draft, support map, fix gaps, file), the support map as the centrepiece with a supported/partly/missing bar, a fix-gaps step whose answers are added to the description for a redraft, and a filing step with the 12-month nonprovisional/PCT date (weekend roll, grace-period check) and an .ics reminder. The default page is unchanged; v=2 views count as /?v=2 and v=2 drafts as draft-v2 so step 2 can compare the variants. // 3.13.0 IPATENT-DRAFT-METERING-1 (2026-10-07, agent_issues 2055 and 1903, pillar cost): every draft model call (success or error) is metered into qnfo-audit ai_call_counters (worker qnfo-ipatent, purpose draft, model, calls, errors, in_chars, ms, tokens and neurons when the binding reports usage) through the AUDIT binding, fail-soft; built by code task ct_i0b4q32jxbvia7 and reviewed by session_013sMN4 before landing. 3.12.1 BUDGET-SOFT-ROUTE-1 (2026-10-06, pillar cost): the benchmark note no longer says model steps wait on a breached cap; a cap selects the cheapest capable model. /* 3.12.0 MECHANISM-FIRST-1 UI: ?v=2 shows the mechanism card step between describe and draft (read, correct, holes in red) and drafts with the card; the default page is unchanged; 3.11.1 a distinction with no nearest known approach is a hole (live check 2026-10-06: a PCM cooling tile named the PCM itself as the distinction); 3.11.0 MECHANISM-FIRST-1 (#2053): POST /api/mechanism reads a mechanism card (what it is, what it does, how it works, the distinction, nearest known, operating window) and /api/draft derives claims from a supplied card; every draft gets the means-not-law, structure-for-function and enabled-range rules; 3.10.1: benchmark text decodes HTML entities in one pass, so "&amp;lt;" stays the literal "&lt;" in stored claims (CodeQL js/double-escaping alerts 335/336 on PR 627); 3.10.0 BENCH-DATASET-1 (#1779 step 1): GET/POST /api/benchmark/dataset builds the 30-patent benchmark sample (CPC G06N, A61B, H01M; granted 2025-H1; direct claim to a US provisional within 366 days) from the keyless USPTO Patent Public Search API, one field per POST with paced reads, stored once in R2 benchmark/dataset.json; no model calls; 3.9.7: the benchmark source probes return fixed error strings and log the exception (CodeQL js/stack-trace-exposure on PR 624) */ // Worker Contract v1: VERSION constant == /health version

var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var __defProp22 = Object.defineProperty;
var __name22 = /* @__PURE__ */ __name2((target, value) => __defProp22(target, "name", { value, configurable: true }), "__name");
var __defProp222 = Object.defineProperty;
var __name222 = /* @__PURE__ */ __name22((target, value) => __defProp222(target, "name", { value, configurable: true }), "__name");
var AI_EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
// DRAFT-LATENCY-1 (3.6.1): the ladder began with deepseek-v4-pro twice at full reasoning; a live draft on 2026-10-02
// returned nothing in 200 s and no draft had succeeded since 2026-09-11. Fast models first, each attempt raced against
// its own deadline inside a total budget, so a slow model is skipped instead of hanging the request. The response
// reports every attempt (model, ms, outcome), so the order can be tuned from live evidence.
var AI_DRAFT_MODELS = [
  "@cf/openai/gpt-oss-120b",
  "@cf/zai-org/glm-5.3-flash",
  "@cf/deepseek-ai/deepseek-v4-flash-0731"
];
var DRAFT_EFFORT = { "@cf/zai-org/glm-5.3-flash": "low" };
var DRAFT_ATTEMPT_MS = 60000;
var DRAFT_BUDGET_MS = 115000;
var DRAFT_MIN_ATTEMPT_MS = 20000;
var IDEA_BANK = JSON.parse(`[{"title": "Analog Quantum Observation And Simulation System Using Non Collapsing Probabilistic States (1)", "technical_field": "99_Brutal_Cleanup", "description": "OF THE DISCLOSURE A system for analog quantum information processing is disclosed, configured to operate on quantum states without inducing immediate projective collapse. The system comprises an engineered Wave-Sustaining Medium (WSM) designed to sculpt and sustain delocalized resonant quantum field patterns, functioning at elevated temperatures (10K-30K) due to an integrated multi-modal nanoscale noise mitigation system. Information is encoded and manipulated via precisely tuned analog electromagnetic fields, interpreting quantum superposition as a complex chord of frequencies. A non-destructive measurement system performs resonant selection by selectively interacting with specific\u2026"}, {"title": "Apparatus For Harmonic Resonance Computing Resonant Field Comput Non Provisional 2025 07 24", "technical_field": "General", "description": "field detection and analysis components configured to measure final quantum states of the resonant wave fields to extract computational results; and a classical control system configured to orchestrate said field generation components, field modulation components, and field detection and analysis components, and further configured to implement controlled decoherence as a computational mechanism for inherent error self-correction and state stabilization by engineering dissipative processes within the apparatus. 2. The apparatus of embodiment 1, wherein the quantum properties comprise at least one of quantized energy states, phase relationships, amplitude distributions, polarization\u2026"}, {"title": "Autaxys Ontological Framework And Generative Engine Provisional Patent Application 20250719 222735", "technical_field": "General", "description": "A computer-implemented system and method for generating emergent patterns and simulating physical phenomena are disclosed. The system operates based on the principle of Autaxys, defined as the intrinsic capacity for self-ordering, self-arranging, and self-generating patterned existence. A \\"generative engine\\" computationally processes relational data through core operational dynamics including relational processing, spontaneous symmetry breaking, feedback dynamics, resonance, and critical state transitions. These dynamics are guided by meta-logical principles such as intrinsic coherence, conservation of distinguishability, parsimony, intrinsic determinacy/emergent probabilism, and\u2026"}, {"title": "Computational System And Method For Generating Emergent Patterns Provisional Patent Application 20250720 050637", "technical_field": "General", "description": "OF THE INVENTION The present invention provides a computer-implemented system and method for generating emergent patterns and simulating physical phenomena based on an intrinsic generative computational process. The system employs a \\"Generative Pattern Discovery System\\" (GPDS) comprising one or more interconnected computational modules configured to execute core operational dynamics, including relational processing, controlled perturbation, iterative refinement, pattern amplification, and phase transition detection. These dynamics are guided by computationally defined principles such as optimizing pattern coherence, preserving distinct elements, promoting structural parsimony,\u2026"}, {"title": "Harmonic Quantum Computing Platform And Method For Optimization And Universal Computation V1", "technical_field": "Generic and Mixed", "description": "OF THE INVENTION The present invention provides a comprehensive and robust quantum computing solution that addresses critical challenges of scalability, operating cost, and environmental stability. The disclosed quantum computing platform leverages a room-temperature, harmonic computing architecture realized on a scalable silicon photonics platform. This configuration provides a pathway to practical quantum advantage. The present quantum computing platform is a scalable, room-temperature, dual-mode quantum computing platform fabricated on a monolithic silicon photonics integrated circuit (PIC). The platform encodes and processes information through the manipulation of coherent harmonic\u2026"}, {"title": "Harmonic Resonance Computer Hrc System On Chip With Self Optimiz Non Provisional Patent Application 20250728 192001", "technical_field": "General", "description": "## ABSTRACT OF THE DISCLOSURE A hybrid, room-temperature computational System-on-Chip (SoC) is disclosed, integrating a general-purpose digital processing unit, a real-time digital control unit, and a self-optimizing photonic co-processor. The photonic co-processor employs a dynamically reconfigurable optical energy landscape, generated by a spatially programmable optical modulator, to represent computational problems. A closed-loop feedback process, managed by the real-time digital control unit, continuously measures the light state within the photonic co-processor. This measurement is used to iteratively calculate and apply updates to both the coherent light drive signal and the\u2026"}, {"title": "Harmonic Resonance Computer System On Chip With Self Optimizing Photonic Co Processor", "technical_field": "Wave Based Computing", "description": "OF THE DISCLOSURE A hybrid, room-temperature computational System-on-Chip (SoC) is disclosed, integrating a general-purpose digital processing unit, a real-time digital control unit, and a self-optimizing photonic co-processor. The photonic co-processor employs a dynamically reconfigurable optical energy landscape, generated by a spatially programmable optical modulator, to represent computational problems. A closed-loop feedback process, managed by the real-time digital control unit, continuously measures the light state within the photonic co-processor. This measurement is used to iteratively calculate and apply updates to both the coherent light drive signal and the optical modulation\u2026"}, {"title": "Harmonic Resonance Computing And Architectures For Quantum Information Processing", "technical_field": "Quantum Resonance Computing", "description": "dalities. \u2022 Initial Content Input: Accepts diverse content, including unstructured (user prompts, existing documents), semi-structured (XML, JSON), or structured data (databases, APIs, real-time streams), across modalities (textual, visual, auditory). \u2022 Iterative Refinement toward Target/Emergent Output State: The system iteratively refines the input content. The target can be a predefined output state or, uniquely, an \\"emergent output state\\" (dynamically determined optimal content quality, structure, or thematic coherence, balancing multiple attributes, e.g., 'most engaging marketing ad'). This is achieved through continuous internal evaluation and adaptive modification. \u2022 Optimization\u2026"}, {"title": "Harmonic Resonance Computing And Resonant Field Computers For Frequency Based Quantum", "technical_field": "Wave Based Computing", "description": "A novel computational paradigm, Harmonic Resonance Computing (HRC), and associated systems, Resonant Field Computers (RFCs), are disclosed for frequency-based quantum computation. Unlike particle- centric quantum computing, HRC encodes quantum information into the quantized energy states, phase relationships, and amplitude distributions of resonant wave fields, such as electromagnetic (e.g., photons in cavity modes) or acoustic fields (e.g., phonons). RFCs comprise resonance chambers, field generators, modulators, and detectors configured to manipulate these quantized fields through precisely tuned resonant quantum interactions. This approach leverages the collective properties and high\u2026"}, {"title": "Harmonic Resonance Computing And Resonant Field Computers Provisional Patent Application 20250723 070750 (1)", "technical_field": "General", "description": "# ABSTRACT A novel computational paradigm, Harmonic Resonance Computing (HRC), and associated systems, Resonant Field Computers (RFCs), are disclosed for frequency-based quantum computation. Unlike particle-centric quantum computing, HRC encodes quantum information into the quantized energy states, phase relationships, and amplitude distributions of resonant wave fields, such as electromagnetic (e.g., photons in cavity modes) or acoustic fields (e.g., phonons). RFCs comprise resonance chambers, field generators, modulators, and detectors configured to manipulate these quantized fields through precisely tuned resonant quantum interactions. This approach leverages the collective properties\u2026"}, {"title": "Harmonic Resonance Computing Hrc System And Method Utilizing A W Provisional Patent Application 20250719 004536", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE A Harmonic Resonance Computing (HRC) system and method are disclosed, shifting from particle-centric models to a field-theoretic approach. The system utilizes an engineered Wave-Sustaining Medium (WSM) configured to support delocalized quantum resonant electromagnetic field state patterns, termed \\"h-qubits,\\" as fundamental computational units. A control system applies tailored electromagnetic fields to the WSM, inducing controlled interactions and evolution of these h-qubit patterns, thereby performing computation based on their collective resonant behavior. The HRC architecture operates on a \\"frequency ontology,\\" where information is encoded and processed based on\u2026"}, {"title": "Harmonic Resonance Computing Provisional Patent Application 20250713 202546", "technical_field": "General", "description": "OF THE INVENTION The present disclosure introduces Harmonic Resonance Computing (HRC), a novel computing paradigm that realizes computation by establishing, manipulating, and interpreting resonant energy states within specifically structured physical media or by leveraging the intrinsic dynamics of large-scale distributed networks. This approach fundamentally departs from particle-centric, binary qubit models by utilizing a physical medium engineered with a precise geometry, such as a three-dimensional (3D) toroidal configuration, or by repurposing the intrinsic electromagnetic dynamics of existing network infrastructure, such as telecommunications networks. In the engineered toroidal\u2026"}, {"title": "Harmonic Resonance Computing System And Method For Field Theoretic Computation", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE A Harmonic Resonance Computing (HRC) system and method are disclosed, shifting from particle-centric models to a field-theoretic approach. The system utilizes an engineered Wave-Sustaining Medium (WSM) configured to support delocalized quantum resonant electromagnetic field state patterns, termed \\"h-qubits,\\" as fundamental computational units. A control system applies tailored electromagnetic fields to the WSM, inducing controlled interactions and evolution of these h-qubit patterns, thereby performing computation based on their collective resonant behavior. The HRC architecture operates on a \\"frequency ontology,\\" where information is encoded and processed based on\u2026"}, {"title": "Harmonic Resonance Computing System And Method Using Engineered Field State Qubits", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE A harmonic resonance quantum computing system utilizes a precisely engineered Wave-Sustaining Medium (WSM) to sculpt and support delocalized, resonant electromagnetic field state patterns as h-qubits. The WSM comprises High-Temperature Superconductors and ultra-low-loss dielectric materials, engineered for high quality factors and low loss tangents, enabling operation at elevated cryogenic temperatures between 10K and 30K. The system integrates a multi-modal nanoscale noise mitigation system co-fabricated within the WSM, providing intrinsic coherence enhancement. Computation and communication are seamlessly unified through the WSM's inherent field dynamics, addressing\u2026"}, {"title": "Harmonic Resonance Computing System And Method Utilizing A Physical Medium With 3D", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE A Harmonic Resonance Computing system and method are disclosed, utilizing a physical medium engineered with a three-dimensional (3D) toroidal geometry. This unique geometry supports quantum states characterized by a spectrum of semi-harmonic energy levels, which arise from the geometry's periodic boundary conditions and inherent non-linearity. A precise mathematical model, including a GM-function and a second equation, predicts the exact positions of stable quantum states (constructive interference) and unstable nodes (destructive interference) within this geometry. Computation is performed by applying resonant fields corresponding to these predicted semi-harmonic\u2026"}, {"title": "Integrated Nanoscale Quantum Shield For Enhanced Coherent Operation At Elevated Temperatures", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE An integrated nanoscale quantum shield is disclosed for enhancing coherent operation of quantum systems at elevated temperatures. The shield comprises a multi-modal noise mitigation system that integrates photonic bandgap structures, phononic bandgap structures, integrated quasiparticle traps, topological protection layers, liquid dielectric shielding layers, and geometric frustration lattices. This sophisticated integration is configured to simultaneously mitigate various environmental noise sources, including electromagnetic, phononic, thermal, particle, spin, and chemical noise, thereby enabling quantum systems to maintain high coherence, such as a T2 coherence time\u2026"}, {"title": "Liquid Shielded Quantum Device Provisional 2025 07 24", "technical_field": "General", "description": "allenges with environmental noise and efficient light-matter coupling. These stringent environmental requirements make quantum devices impractical for widespread deployment, especially in applications requiring ambient temperature operation, portability, or integration into existing infrastructure. Biological systems, however, exhibit remarkable examples of coherent quantum processes occurring at physiological temperatures. Photosynthesis, olfaction, and enzyme catalysis are believed to involve quantum mechanical phenomena that persist despite the warm, noisy environment of a living cell. Research suggests that the highly ordered, structured water environments within cells play a crucial\u2026"}, {"title": "Machine Learning Architecture Design And Training", "technical_field": "Topological Computing Systems", "description": "OF THE DISCLOSURE A system and method for designing and training machine learning models based on generative first principles is disclosed. A method for designing a machine learning architecture involves calculating a topological stability score for a candidate architecture using a predefined resonance metric. The resonance metric evaluates stability based on number-theoretic properties of the architecture's parameter count (N), allowing for principled architecture selection prior to training. A method for training a machine learning model involves encoding input data into a number-theoretic representation by mapping semantic features to distinct prime numbers. The model is trained by\u2026"}, {"title": "Mass Frequency Identity M For Unifying Relativity And Quantum Me Non Provisional Patent Application 20250730 123228", "technical_field": "General", "description": "## ABSTRACT OF THE DISCLOSURE An Autaxys framework proposes reality as an intrinsically self-ordering, self-arranging, and self-generating system, fundamentally an evolving algorithm. This framework shifts from substance-based ontologies to a process-centric view, emphasizing dynamic processes and emergent patterns. Central to Autaxys is the Mass-Frequency Identity (m=\u03C9), which unifies General Relativity and Quantum Mechanics by reinterpreting mass as an intrinsic processing frequency of fundamental patterns within a Universal Relational Graph (URG). The Autaxic Trilemma (Novelty, Efficiency, Persistence) acts as the core generative engine, driving cosmic evolution and defining physical\u2026"}, {"title": "Mechanical Oscillator Networks For Computation Non Provisional Patent Application 20250728 105346", "technical_field": "General", "description": "## ABSTRACT OF THE DISCLOSURE A novel computational paradigm redefines computation as an emergent property of dynamic, interacting frequency fields, moving beyond particle-centric models. This approach leverages principles of resonance, phase alignment, and time non-locality for information processing. Exemplary architectures include Harmonic Resonance Computing (HRC), which utilizes complex vibration patterns within a continuous field, and Memcomputing, which integrates memory and processing functions using interacting memprocessors and frequency encoding. This paradigm offers inherent scalability, enhanced stability, and integrated error resilience over qubit-based systems. It also\u2026"}, {"title": "Mechanical Oscillator Networks For Computation Provisional Patent Application 20250728 104705", "technical_field": "General", "description": "# SUMMARY OF THE INVENTION The present invention introduces a novel computational paradigm, termed harmonic computing, which fundamentally reinterprets computation as an emergent property of dynamic, interacting frequency fields. This paradigm diverges significantly from traditional particle-centric views, embracing a continuous, field-theoretic perspective. The invention leverages principles of resonance, phase alignment, and time non-locality for information processing, offering a profound shift in how computational operations are conceived and executed. Key architectural embodiments, such as Resonant Field Computing (RFC), Recursive Resonant Architecture (RRA), and Memcomputing, are\u2026"}, {"title": "Method For Fabricating Superconducting Qubits With Integrate Product 20250618 212321", "technical_field": "99_Brutal_Cleanup", "description": "Claims constitute the operative legal definition of the invention, delineating the precise scope of the exclusive rights conferred by the patent. Their formulation demands exceptional precision, rigorous support within the specification, and adherence to the substantive requirements of patentability: eligible subject matter (\xA7 101), novelty (\xA7 102), and non-obviousness (\xA7 103) over the pertinent prior art. During examination, claims are interpreted by the USPTO according to their **Broadest Reasonable Interpretation (BRI)** consistent with the specification, as understood by a **Person Having Ordinary Skill in the Art (PHOSITA)**. Following patent issuance, claims are subject to a\u2026"}, {"title": "Method For Solving Optimization Problems Via Dynamic Optical Ene Provisional Patent Application 20250728 191634", "technical_field": "General", "description": "# SUMMARY OF THE INVENTION The present invention introduces a novel computational system-on-chip (SoC), herein referred to as a hybrid opto-electronic optimization system, which functions as a hybrid, room-temperature, self-optimizing photonic co-processor. This system is specifically designed to achieve unprecedented computational speed and power efficiency for complex optimization problems by utilizing a dynamically reconfigurable optical energy landscape, precisely controlled by a real-time digital feedback loop. This architecture is physically plausible, commercially manufacturable using existing CMOS-compatible technologies, and represents a fundamental paradigm shift in\u2026"}, {"title": "Methods For Programming Non Electronic Media In Harmonic Resonance Computing", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE Disclosed are methods for programming Harmonic Resonance Computing (HRC) units by applying structured non-electrical physical fields to a Wave-Sustaining Medium (WSM). These fields induce reconfigurable physical state changes or resonant adjustments within the WSM, thereby directly embedding computational instructions or problem definitions without reliance on traditional electronic signaling. This enables highly energy-efficient, compact, and reconfigurable computational units for various applications, including IoT and mobile environments."}, {"title": "Nexus Recursive Harmonic Framework Provisional Patent Application 20250720 053709", "technical_field": "General", "description": "# SUMMARY OF THE INVENTION The present invention provides computer-implemented methods and systems for leveraging emergent harmonic constants to stabilize, optimize, and analyze recursive computational processes and data structures. In one aspect, the invention introduces a novel framework, referred to herein as the Nexus Recursive Harmonic Framework, which posits that fundamental constants such as pi (\u03C0) and the golden ratio (\u03C6) are not static values but rather emerge as solutions to structural imbalances within dynamic recursive feedback loops. The invention provides methods for dynamically determining and applying a universal harmonic constant (H), such as H=0.35, derived from\u2026"}, {"title": "Parametric Adiabatic Coherent Optimizer For Combinatorial Optimization V4", "technical_field": "Quantum Resonance Computing", "description": "ngths), and receive raw output data (e.g., measured phase states) at terabit-per-second rates. The optical signals are converted to electrical signals at the **PCP** interface using integrated optoelectronic transceivers. This high-bandwidth, low-latency interconnection enables the rapid programming of large-scale **PCP** arrays and the efficient transfer of vast amounts of solution data for post-processing, minimizing communication bottlenecks between the classical and co-processing units. * **3. Alternative Problem Formulation Software:** * **Identified Function:** Problem Pre-processing and Formulation software within the **CHC**. * **Proposed Alternative:** The **CHC** executes an\u2026"}, {"title": "Passive Photonic Quasi Crystal Apparatus For Robust Fractal Spectral Filtering And Method Of Manufacture Thereof V1", "technical_field": "Photonic Computing", "description": "OF THE DISCLOSURE [0112] A passive photonic apparatus comprises a substrate and a photonic lattice with optical resonators. A physical dimension of each resonator is modulated by a deterministic irrational function relative to its spatial index, inducing an Aubry-Andr\xE9-Harper potential and generating a fractal transmission spectrum with topologically protected spectral gaps. A negative-tone polymer cladding passively athermalizes the apparatus. A method of manufacture includes defining a Hamiltonian with an irrational parameter, mapping modulated resonator dimensions to a lithographic layout with modulation depth exceeding fabrication grid resolution, and fabricating the apparatus. This\u2026"}, {"title": "Phase Encoded Information System For Unified Storage And Processing", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE A unified information processing system is disclosed, which integrates data storage and processing within a Wave-Sustaining Medium (WSM). Information is encoded in the phase, amplitude, and spatial distribution of complex standing wave patterns or resonant field states within the WSM. The system utilizes a three-dimensional periodic lattice of superconducting resonators, such as Tantalum, designed for high internal quality factors and supporting topologically protected patterns. Computational operations are performed directly within the stored information via localized electromagnetic fields at terahertz frequencies, inducing non-linear optical effects, thereby\u2026"}, {"title": "Probabilistic Information Unit For Data Encoding And Error Correction", "technical_field": "99_Brutal_Cleanup", "description": "This invention discloses a novel method and system for encoding and processing information using probabilistic states in classical systems. The system utilizes stochastic probability distributions and error-correcting codes to achieve high-fidelity information processing without relying on quantum superposition or entanglement. The invention is particularly useful for applications in data storage, communication, and machine learning."}, {"title": "Probabilistic Quantum Information Processing Via Information States", "technical_field": "Niche and Undeveloped", "description": "Information Units: Configurable to represent quantum states as continuous probabilistic distributions (e.g., geometric superpositions in lattice structures). Functional Equivalents: Implementations include microtubule-inspired lattices, photonic arrays, or superconducting qubits (Fig. 1A-1C, not shown). [0008] Enablement: The invention is enabled by principles from quantum information theory (e.g., continuous-variable systems) and experimental work in bio-inspired quantum coherence. For example: Microtubule Lattices: Tubulin subunit arrangements (13-protofilament topology) enable geometric superpositions. Dielectric Shielding: High-permittivity materials (\u03B5 > 50, e.g., SrTiO\u2083) suppress\u2026"}, {"title": "Qpu Provisional Patent", "technical_field": "Bio Inspired", "description": "1 Abstract 23 KB Warning: One or more pages are missing page numbering. Page numbering will be automatically applied after submission. Comments were found and have been removed. Text must be in a single column. Please review and revise if necessary. rowan-quni-doc-19749- SPEC.docx 8 Specification 32 KB Warning: Comments were found and have been removed. Paragraph numbering is missing from the specification. Please review the specification and revise if necessary. Text must be in a single column. Please review and revise if necessary. Page 1 of 2 Digest DOCUMENT MESSAGE DIGEST(SHA-512) generatedADS68995359.pdf 25F5218432127A97EC2F1CB2F3FE28378480D2E05B4F0BDB2\u2026"}, {"title": "Quantum Biology Inspires Computing Inventions", "technical_field": "General", "description": "herence could be used to design more stable and robust qubits. For example, researchers are exploring the use of photosynthetic proteins as qubits . * **Quantum algorithms:** Quantum entanglement could be used to develop new quantum algorithms that are more efficient than classical algorithms. For example, researchers are exploring the use of bird navigation mechanisms to develop new quantum algorithms for optimization problems . * **Error correction:** Quantum tunneling could be used to develop new error correction protocols for quantum computers. For example, researchers are exploring the use of enzyme catalysis mechanisms to develop new quantum error correction codes . Furthermore,\u2026"}, {"title": "Quantum Computing Patentability Memo Diffs 20250628 104311", "technical_field": "General", "description": "lexity, latency, and I/O count, enabling more complex control and feedback. However, these electronics are sources of electromagnetic noise (switching noise, digital noise, amplifier noise) and heat dissipation. PC shielding is critical for isolating the sensitive qubits from these sources via robust electromagnetic and thermal barriers. PC bandgaps are designed to target the noise spectrum of the electronics. Routing signals between the electronics layer and the qubit layer requires careful design of vias, airbridges, or waveguides passing through PC structures, ensuring minimal noise coupling and signal degradation. The noise floor and heat dissipation profile of the cryogenic\u2026"}, {"title": "Quantum Computing System With Liquid Helium Operation And Hardware Level Bosonic Error Correction", "technical_field": "63940352 Quantum Computing", "description": "on (175), a Feedback-Controlled Active Isolation (176) system, or a Pneumatic Isolation Platform (177). A kit (K100) includes a plurality of vibration isolation components (171). #### 2.7 Control Electronics (190) [0036] Control Electronics (190) are electrically coupled to the Three-Dimensional Microwave Cavity (110). These electronics (190) generate and deliver precise control pulses necessary for quantum operations, including qubit initialization, quantum gate execution, and state readout. [0037] The Control Electronics (190) receive instructions from a Classical Computing Interface (180). They translate these instructions into microwave pulses (D8.1), flux pulses (D8.2), optical\u2026"}, {"title": "Quantum Entanglement Generator With Enhanced Coherence  Bb84 Product 20250619 095627", "technical_field": "99_Brutal_Cleanup", "description": "--- generation_timestamp: 2025-06-19T04:11:27.193Z project_name: \\"Quantum Entanglement Generator With Enhanced Coherence (BB84)\\" autologos_process_mode: distillation initial_prompt_summary: \\"--- FILE: Quantum Entanglement Generator With Enhanced Coherence.md --- Quantum Entanglement Generator With Enhanced Coherence [0001] The present i...\\" final_iteration_count: 1 max_iterations_setting: 10 prompt_input_type: direct_text prompt_source_details: \\"log_import_Quantum_Claim_Wherein_Shield_Medium_log_20250617_133956.json\\" model_configuration: model_name: 'gemini-2.5-flash-preview-04-17' temperature: 0.20 top_p: 0.82 top_k: 15 --- Decoherence constrains quantum systems, conventionally\u2026"}, {"title": "Quantum Key Distribution With Machine Learning Enhanced Eavesdropping Detection", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE The present invention enhances Quantum Key Distribution (QKD) systems by transforming decoherence from a vulnerability into an active security mechanism for eavesdropping detection. It introduces a novel approach where a decoherence control module actively induces a predetermined, non-Markovian decoherence signature into quantum states transmitted through the channel. A processing unit then utilizes a specialized machine learning algorithm to analyze deviations from this signature, accurately classifying them as either natural environmental noise or a malicious eavesdropping attempt. This method, potentially employing terahertz-frequency pulse generators for controlled\u2026"}, {"title": "Quantum Key Distribution With Machine Learning V4", "technical_field": "Quantum Resonance Computing", "description": "OF THE INVENTION The present invention addresses critical limitations inherent in Quantum Key Distribution (QKD) systems, including restricted transmission range, susceptibility to environmental noise, and vulnerabilities arising from device imperfections, particularly in the context of advanced threat vectors and emerging computational challenges such as Harmonic Resonance Computing (HRC). The invention introduces a novel paradigm that transforms quantum decoherence from a passive vulnerability into an active, robust security mechanism, leveraging controlled decoherence and machine learning for enhanced eavesdropping detection. In a primary embodiment, a Quantum Key Distribution (QKD)\u2026"}, {"title": "Quantum Processing Unit With Bio Inspired Lattice Structure For Enhanced Qubit Coherence And Scalability", "technical_field": "Bio Inspired", "description": "OF THE INVENTION The invention's novelty lies in its bio-inspired design that mimics the structure of neuronal microtubules to create a uniquely tailored electromagnetic environment for enhancing qubit coherence and enabling higher temperature operation than conventional quantum computing architectures. Specifically, the invention combines the following new elements: * A Microtubule-Inspired Lattice Structure: A cylindrical lattice fabricated using CMOS-compatible processes and high-temperature superconductors (HTS), designed to mimic the geometry of biological microtubules. This structure is unlike any current qubit architecture (which are typically planar or use simple multi-chip\u2026"}, {"title": "Quantum Resonance Computing Systems And Methods For Stable Quantum Computation", "technical_field": "Quantum Resonance Computing", "description": "A Quantum Resonance Computing (QRC) system and method are disclosed for stable quantum computation. The invention leverages intrinsic, stable resonant frequencies within quantum systems to encode and process quantum information, addressing limitations of conventional gate-based quantum computing, particularly quantum decoherence. Inspired by classical resonant computing devices such as the parametron, QRC utilizes continuous parametric excitation to establish and sustain robust quantum resonant states for information processing, thereby enhancing coherence and stability."}, {"title": "Quantum Resonance Dynamics Framework For Stabilized Qubits And Non Collapsing Wavefunctions", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE A Quantum Resonance Dynamics (QRD) framework is disclosed for quantum information processing. This framework reinterprets fundamental quantum phenomena, stabilizing quantum information units through inherent resonance rather than traditional error correction. Wavefunction collapse is re-envisioned as a structured phase-selection process, and decoherence as a transition to a stable phase-locked resonance state. The system utilizes a Wave-Sustaining Medium (WSM) with engineered three-dimensional toroidal physical geometry and chiral lattice structures. These properties facilitate chiral phase-locking resonance and topological protection, enabling robust quantum coherence\u2026"}, {"title": "Quantum Resonance Dynamics Qrd Framework For Stabilized Qubits A Provisional Patent Application 20250719 150841", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE A Quantum Resonance Dynamics (QRD) framework is disclosed for quantum information processing. This framework reinterprets fundamental quantum phenomena, stabilizing quantum information units through inherent resonance rather than traditional error correction. Wavefunction collapse is re-envisioned as a structured phase-selection process, and decoherence as a transition to a stable phase-locked resonance state. The system utilizes a Wave-Sustaining Medium (WSM) with engineered three-dimensional toroidal physical geometry and chiral lattice structures. These properties facilitate chiral phase-locking resonance and topological protection, enabling robust quantum coherence\u2026"}, {"title": "Resonance Breach Analysis Methodology And System For Quantum Key Distribution", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE The present disclosure introduces a novel Resonance Breach Analysis (RBA) methodology and system designed to identify latent security vulnerabilities within practical Quantum Key Distribution (QKD) systems. Despite QKD's theoretical robustness, physical implementation flaws can lead to exploitable side-channel attacks. The RBA method systematically addresses this by identifying potential resonant interaction points within QKD hardware components, applying precisely controlled physical stimuli tailored to these points, and monitoring for disproportionate, non-linear technical responses. Detecting such unexpected changes indicates a latent security vulnerability, enabling\u2026"}, {"title": "Resonance Breach Analysis Rba Methodology And System For Qkd Vul Provisional Patent Application 20250719 001733", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE The present disclosure introduces a novel Resonance Breach Analysis (RBA) methodology and system designed to identify latent security vulnerabilities within practical Quantum Key Distribution (QKD) systems. Despite QKD's theoretical robustness, physical implementation flaws can lead to exploitable side-channel attacks. The RBA method systematically addresses this by identifying potential resonant interaction points within QKD hardware components, applying precisely controlled physical stimuli tailored to these points, and monitoring for disproportionate, non-linear technical responses. Detecting such unexpected changes indicates a latent security vulnerability, enabling\u2026"}, {"title": "Resonance Breach Analysis System And Method For Quantum Key Distribution V2", "technical_field": "Quantum Resonance Computing", "description": "OF THE INVENTION The present disclosure relates generally to security assessment, and more particularly, to systems and methods for identifying latent security characteristics within Quantum Key Distribution (QKD) systems. Practical implementations of QKD systems, while possessing robust theoretical security guarantees, exhibit specific characteristics at the physical implementation layer that are precisely characterized and exploited to circumvent conventional cryptographic and computational security models. These characteristics manifest as subtle physical phenomena or intricate system-level interactions, frequently leading to sophisticated side-channel attacks that exploit specific\u2026"}, {"title": "Resonant Field Cipher Product 1.1 Title Of The Invention 0708 0543", "technical_field": "General", "description": "## SUMMARY OF THE INVENTION The present invention introduces Resonant Field Computing (RFC), a novel quantum computing paradigm that fundamentally shifts from manipulating discrete particles to manipulating coherent resonant electromagnetic field states within a continuous, engineered medium. Conceptually inspired by a proposed process ontology (Autaxys) where reality is a dynamically self-organizing computational system and mass is fundamentally a manifestation of frequency ($m=\\\\omega$ in natural units), RFC seeks to embody principles of Persistence (maintaining stable structures/states) and Efficiency (optimizing configurations for low loss/high performance) in engineered physical\u2026"}, {"title": "Resonant Field Computing Rfc Based On Autaxys Principles Non Provisional Patent Application 20250730 124831", "technical_field": "General", "description": "## ABSTRACT OF THE DISCLOSURE The disclosure presents the Autaxys framework, modeling reality as an intrinsically self-ordering, self-generating evolving algorithm. It shifts from substance-based ontologies to a process-centric view, emphasizing dynamic patterns. Central is the Mass-Frequency Identity (m=\\\\u03c9), reinterpreting mass as an intrinsic processing frequency of fundamental patterns within a Universal Relational Graph (URG). The Autaxic Trilemma (Novelty, Efficiency, Persistence) drives cosmic evolution and defines physical laws through continuous, self-validating computation. This framework provides a coherent explanation for spacetime, gravity, and particles, and has\u2026"}, {"title": "Resonant Field Computing Rfc Based On Autaxys Principles Provisional Patent Application 20250730 124004", "technical_field": "General", "description": "# SUMMARY OF THE INVENTION The present disclosure introduces a novel computational paradigm, herein referred to as **Resonant Field Information Processing (RFIP)**, or more broadly, **Resonant Field Computing (RFC)**. This paradigm leverages the principles of resonant interactions within various types of physical fields (e.g., electromagnetic, acoustic, quantum) to perform computational operations. In this context, \\"computing\\" is broadly defined as any process involving the transformation, manipulation, storage, or transmission of information, states, or energy within a system. This encompasses, but is not limited to, data processing, pattern recognition, simulation, optimization,\u2026"}, {"title": "Resonant Field Computing Rfc Based On The Autaxys Framework Provisional Patent Application 20250730 115649", "technical_field": "General", "description": "# SUMMARY OF THE INVENTION The present invention introduces novel systems and methods for field-based computation, which leverages dynamic interactions within and between computational fields to process information and model complex systems. This approach is underpinned by a unified dynamic process ontology, which conceptualizes reality and its computational manifestations as an interconnected network of evolving processes rather than discrete, static entities. This dynamic process ontology provides a structured yet flexible architecture for defining, manipulating, and observing these computational fields and their resonant interactions. In one aspect, the invention provides a\u2026"}, {"title": "Resonant Field Computing System And Method Using Engineered Field State Qubits (1)", "technical_field": "General", "description": "OF THE DISCLOSURE A quantum computing system utilizes a precisely engineered wave-sustaining medium (WSM) to sculpt and support addressable coherent resonant electromagnetic field state patterns, termed h-qubits, where quantum information is encoded in the delocalized quantum state of these patterns. The WSM comprises a three-dimensional superconducting lattice structure and a high-permittitivity, ultra-low-loss dielectric material, and integrates co-fabricated multi-modal nanoscale noise mitigation systems to enhance intrinsic coherence and enable operation at elevated cryogenic temperatures, such as between 10K and 30K. The WSM also functions as a seamless computational space and\u2026"}, {"title": "Spectral Resonance Computing Src System For Intractable Problems Provisional Patent Application 20250719 232423", "technical_field": "General", "description": "OF THE INVENTION The present invention introduces Spectral Resonance Computing (SRC), a novel computational paradigm engineered to efficiently resolve computationally intractable problems, particularly those within the NP (Non-deterministic Polynomial time) complexity class. Unlike conventional digital computing architectures that rely on sequential processing and discrete logic, or established quantum computing techniques that leverage quantum mechanical phenomena for direct calculation, SRC operates by harnessing the intrinsic principles of harmonic resonance and the spontaneous emergence of complex geometric configurations within a dynamic physical system. This system functions as a\u2026"}, {"title": "Spectral Resonance Computing System And Method For Solving Computationally Intractable Problems", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE The present disclosure introduces Spectral Resonance Computing (SRC), a novel computational paradigm designed to solve computationally intractable problems, particularly those in the NP complexity class, such as large integer factorization and the 3-Satisfiability problem. Unlike conventional digital or quantum computing, SRC operates by harnessing the intrinsic principles of harmonic resonance and the spontaneous emergence of complex geometric configurations within a dynamic physical system. Problem parameters are encoded into the initial phase and amplitude relationships of pure resonance harmonics generated by elements like nanoscale piezoelectric vibrators, which\u2026"}, {"title": "System And Method For Controlled Non Markovian Decoherence In Quantum Computing V2", "technical_field": "Quantum Resonance Computing", "description": "## SUMMARY OF THE INVENTION The present invention provides a novel system and method for inducing, controlling, and actively harnessing non-Markovian decoherence as a valuable computational resource in quantum computing and communication. The invention provides a solution to the limitations of conventional quantum systems, which predominantly treat decoherence as an error to be suppressed, by instead utilizing its inherent properties for computational advantage. A core aspect of the invention is the **Decoherence Control Module (DCM)**, which employs engineered noise sources to generate non-Markovian noise. This noise features precisely tailored frequency spectra and temporal profiles,\u2026"}, {"title": "System And Method For Harnessing Controlled Non Markovian Decoherence", "technical_field": "Early_Drafts_202507", "description": "OF THE DISCLOSURE A system and method for harnessing controlled, non-Markovian decoherence in quantum computing and communication. The system includes a decoherence control module configured to intentionally induce decoherence via engineered non-Markovian noise channels. This controlled decoherence is leveraged for various applications, including quantum annealing for optimization, enhanced quantum sensing, advanced error mitigation, and temporal data storage. The system further incorporates dynamic qubit state control and a hybrid quantum-classical interface to precisely manage and utilize these decoherence pathways."}, {"title": "System And Method For High Temperature Topological Quantum Processing", "technical_field": "High Temperature Topological Chiral", "description": "representation. [0332] FAILURE MODES In the event of Thermal Failures, the system tolerates and mitigates a Cooling Failure. The intrinsic error suppression via the large superconducting gap ensures a grace period before decoherence becomes catastrophic, allowing for recovery. [0333] Temperature Fluctuation is another Thermal Failure. While the Pulse Tube Cryocooler [104] provides stable 4K operation, minor fluctuations occur. The topological protection and large gap buffer these fluctuations, preventing immediate loss of quantum coherence. Localized Peltier stages or feedback loops further stabilize temperature. [0334] If the Heat Load Exceeds, the system gracefully degrades or pauses.\u2026"}, {"title": "System And Method For Low Energy Nuclear Reactions For Energy Pr Non Provisional 2025 07 25", "technical_field": "General", "description": "OF THE DISCLOSURE A computer-implemented system and method for generating energy through low-energy nuclear reactions (LENR) at room temperature or near-room temperature conditions. The method involves initiating a nuclear reaction, such as by electrochemical loading of hydrogen isotopes into a metallic lattice, plasma discharge, acoustic cavitation, or laser interaction, and producing energy therefrom. The system comprises a reaction chamber, which can be configured as an electrochemical cell, a plasma chamber, or a solid-state device, designed to facilitate these reactions. An energy extraction mechanism, such as a heat exchanger or thermoelectric generator, is coupled to the chamber\u2026"}, {"title": "System And Method For Probabilistic Quantum Information Processing Via Abstract Information States", "technical_field": "Niche and Undeveloped", "description": "Information Units: Configurable to represent quantum states as continuous probabilistic distributions (e.g., via geometric superpositions in lattice structures). Functional Equivalents: Implementations may include microtubule-inspired lattices, photonic arrays, or superconducting qubits, but the claims are not limited to these embodiments. 2. Probabilistic Processing Mechanisms [0006] Processing means include: Analog Controls: Electromagnetic fields, acoustic waves, or mechanical stress modulate lattice parameters to steer state evolution. Non-Demolition Measurements: Interferometric detectors reconstruct probabilistic distributions via inverse Fourier transforms without collapse. 3.\u2026"}, {"title": "System And Method For Solving Optimization Problems", "technical_field": "Wave Based Computing", "description": "OF THE INVENTION The present invention introduces a novel computational system-on-chip (SoC), herein referred to as a hybrid opto-electronic optimization system, which functions as a hybrid, room-temperature, self-optimizing photonic co-processor. This system is specifically designed to achieve unprecedented computational speed and power efficiency for complex optimization problems by utilizing a dynamically reconfigurable optical energy landscape, precisely controlled by a real-time digital feedback loop. This architecture is physically plausible, commercially manufacturable using existing CMOS-compatible technologies, and represents a fundamental paradigm shift in high-performance\u2026"}, {"title": "System And Method For Topological Scale Invariant Photonic Computation With Analog Emulation Of Quantum Behavior V1", "technical_field": "Photonic Computing", "description": "sed, comprising a substrate, a quasi-periodic photonic lattice defined on the substrate exhibiting discrete scale invariance, a superlattice structure creating a moir\xE9 potential, a topological interface configured to support protected optical modes, a nonlinear optical element configured to generate emergent particle-like excitations, and a detection system configured to interpret interactions of said excitations as computational results. [0011] A photonic system for emulating quantum statistical behavior is disclosed, the system including a light source, an integrated photonic circuit having a reconfigurable topological scale-invariant waveguide architecture, means for generating and\u2026"}, {"title": "System And Method For Unsupervised Iterative Content Refinement Provisional Patent Application 20250722 175720", "technical_field": "General", "description": "# SUMMARY OF THE INVENTION The present invention provides a novel computer-implemented system and method for autonomous, iterative content generation and refinement using artificial intelligence. The core innovation lies in its ability to accept a diverse initial content input, which may include unstructured data such as a user prompt, existing documents, or a partial draft; semi-structured data like XML or JSON files; or structured data from databases, APIs, or real-time data streams. Crucially, this input can encompass various modalities, including textual, visual (e.g., images, video frames), or auditory (e.g., audio clips, speech segments) data. The system then automatically,\u2026"}, {"title": "Systems And Methods For Aperiodic Waveform Modulation Based On Number Theoretic Geometries", "technical_field": "Generic and Mixed", "description": "OF THE INVENTION [0006] The present invention provides a system and method for generating aperiodic communication waveforms based on the geometric encoding of prime numbers. This approach overcomes the limitations of conventional periodic modulation schemes by leveraging the inherent structural stability of prime number distributions mapped onto a geometric manifold. [0007] A primary object of the present invention is to provide a physical layer security mechanism, termed Symbol Waveform Hopping (SWH), that is based on physical resolution limits rather than computational complexity, rendering it immune to quantum and classical computational attacks. The SWH mechanism dynamically changes\u2026"}, {"title": "Systems And Methods For Computation Using Engineered Intrinsic Topological Media", "technical_field": "Topological Broad Typo", "description": "OF THE DISCLOSURE A system for performing a computational operation includes a Physical Medium (PM) engineered to possess an Intrinsic Topological State (ITS) characterized by a protective energy gap for thermal robustness. Information is encoded in a global property of the ITS. A Control System (CS) induces a native dynamical process of the ITS to execute the computational operation, and a Readout System (RS) measures a property of the PM to determine the result. The system operates without active error correction and can function at room temperature. A specialized, non-programmable co-processor is also disclosed. Methods for manufacturing and operating such systems are included."}, {"title": "Systems And Methods For Distributed Quantum Resonance Computing V4", "technical_field": "Quantum Resonance Computing", "description": "## SUMMARY OF THE INVENTION The present invention provides a complete, end-to-end system and method for what is termed herein as Quantum Resonance Computing (QRC), which transforms heterogeneous, geographically distributed telecommunications infrastructure into a programmable, large-scale physical information processing substrate. The invention overcomes the profound and long-standing limitations of the prior art through a synergistic integration of several novel and non-obvious subsystems, signal processing protocols, and control architectures, each of which represents a distinct inventive concept, as well as inventive combinations thereof. A primary object of the invention is to\u2026"}, {"title": "Systems And Methods For Topological Computation", "technical_field": "Topological Broad Typo", "description": "odiment, the low-temperature bonding process is a hybrid bonding process performed at a temperature below 150\xB0 Celsius to preserve a magnetic property of a ferromagnetic layer within the moir\xE9 heterostructure. This specifies the temperature constraint for the final integration step to avoid degrading sensitive materials. [0067] The system of claim [0041] is further described. In this embodiment, the zero-dimensional topologically protected corner state has a coherence time that is at least an order of magnitude longer than a coherence time of edge states on the Physical Medium (PM). This highlights the enhanced stability of the specific corner state used in the HOTI qubit. [0068] A\u2026"}, {"title": "Topological Quantum Computation Using Number Theoretic Pattern Operations V1.0", "technical_field": "99_Brutal_Cleanup", "description": "OF THE DISCLOSURE A system and method for topological quantum computation are disclosed. The method performs computation through a sequence of pattern operations on a quantum state represented as a topological loop on a circle manifold, the loop being characterized by an integer winding number. A pattern writing operation encodes information based on a prime factorization of the winding number. A pattern evolution operation applies a rotation operator to evolve the state. A pattern projection operation extracts a computational result. The invention further discloses a method for designing a quantum device by calculating a resonance metric based on prime factors of a system parameter to\u2026"}]`);
var CANONICAL_ORIGIN = "https://ipatent.qnfo.org";
var ORCID_URL = "https://orcid.org/0009-0002-4317-5604";
// PRIVATE-BY-DEFAULT-1 (3.5.0): an inventor's text is confidential until filed. Nothing is stored unless the inventor
// opts in, stored rows hold a salted IP hash (never the raw IP), and no public route lists submissions.
async function hashIp(ip) {
  const data = new TextEncoder().encode("ipatent-rl-v1:" + String(ip || "unknown"));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return "h:" + Array.from(new Uint8Array(buf)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hashIp, "hashIp");
function adminOk(request, env) {
  const t = env.IPATENT_ADMIN_TOKEN;
  return !!t && safeEqual(request.headers.get("X-Admin-Token") || "", String(t));
}
// Constant-time string comparison (both sides are hashed first, so neither length nor content leaks through timing).
function safeEqual(a, b) {
  const enc = new TextEncoder(), x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i % (x.length || 1)] || 0) ^ (y[i % (y.length || 1)] || 0);
  return diff === 0;
}
// A response body read as text, stopped at max bytes (an external page is never buffered without a bound).
async function readTextCapped(resp, max) {
  if (!resp || !resp.body || !resp.body.getReader) return String(await resp.text()).slice(0, max);
  const reader = resp.body.getReader(), dec = new TextDecoder();
  let out = "", got = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    got += step.value.byteLength;
    out += dec.decode(step.value, { stream: true });
    if (got >= max) { try { await reader.cancel(); } catch (e) { console.error(JSON.stringify({ worker: "qnfo-ipatent", where: "readTextCapped", error: String(e && e.message || e) })); } break; }
  }
  return out + dec.decode();
}
__name(adminOk, "adminOk");
// PAGE-METRICS-1 (3.5.1): iPatent had no pageview measurement at all (no beacon; the D1 analytics table stopped on
// 2026-07-12). Each GET of / or /guide adds 1 to a daily counter keyed by path and source class. No IP, user agent,
// cookie or referrer URL is stored: only the class (search, qnfo, referral, direct, crawler). GET /api/metrics serves
// 7d and 30d aggregates; qnfo-fleet-control IMPROVEMENT-LOOP-1 reads them into metric_registry every hour.
var PV_BOT = /bot|crawl|spider|slurp|preview|headless|curl|wget|python|httpclient|go-http|java\/|okhttp|axios|node-fetch|lighthouse|pingdom|uptime|monitor|scanner|facebookexternalhit|embedly|whatsapp|telegram/i;
var PV_SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|qwant|yandex|baidu|startpage|search\.brave|kagi|perplexity|chatgpt|you)\./i;
var PV_READY = false;
function pageSource(request) {
  const ua = request.headers.get("User-Agent") || "";
  if (!ua || PV_BOT.test(ua)) return "crawler";
  let host = "";
  try { host = new URL(request.headers.get("Referer") || "").hostname.toLowerCase(); } catch (e) { host = ""; }
  if (!host) return "direct";
  if (host === "ipatent.qnfo.org") return "internal";
  if (PV_SEARCH.test(host + ".")) return "search";
  if (host === "qnfo.org" || host.endsWith(".qnfo.org")) return "qnfo";
  return "referral";
}
__name(pageSource, "pageSource");
// AB-SPLIT-V2-1 (IPATENT-UI-OVERHAUL-1 step 2, agent_issues 2049, 2026-10-09, pillar reach): nothing linked to ?v=2, so in
// its first day it had 1 crawler view and 0 human views against 70 human views of "/", and the 7-day comparison could
// never measure anything. A human GET / without a v parameter is now assigned to an arm (first by the cookie ipatent_ab, the arm
// number only, no identifier, 30 days; since 3.19.1 by a random draw per page load and no cookie, see BP26-NO-TRACKING-1 below): arm 2 is redirected to the same URL with v=2 (counted as "/?v=2"), arm 1 is served
// the default page (counted as "/"). Crawlers, HEAD, an explicit ?v=1 or ?v=2 and a share of 0 keep today's behaviour.
// The arm-2 share is qnfo-audit ops_config ipatent_v2_share (0..1, read through AUDIT, cached 5 minutes per isolate), so
// "0" turns the split off without a deploy; env IPATENT_V2_SHARE overrides it; no row, no binding or a failed read is 0.
var AB_COOKIE = "ipatent_ab";
var AB_CACHE_MS = 3e5;
var _abShareCache = { at: 0, v: 0 };
function abClamp(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}
async function abShare(env, now) {
  const fromEnv = abClamp(env && env.IPATENT_V2_SHARE);
  if (fromEnv !== null) return fromEnv;
  if (!env || !env.AUDIT) return 0;
  const t = now || Date.now();
  if (_abShareCache.at && t - _abShareCache.at < AB_CACHE_MS) return _abShareCache.v;
  let v = 0;
  try {
    const row = await env.AUDIT.prepare("SELECT value FROM ops_config WHERE key = 'ipatent_v2_share'").first();
    v = abClamp(row && row.value) || 0;
  } catch (e) { v = 0; }
  _abShareCache = { at: t, v };
  return v;
}
function abCookieArm(request) {
  const m = /(?:^|;\s*)ipatent_ab=([12])(?:;|$)/.exec(request.headers.get("Cookie") || "");
  return m ? m[1] : null;
}
// BP26-NO-TRACKING-1 (2026-10-26, agent_issues 1000345): the cookie above is not strictly necessary, so it is retired. No identifier of any kind replaces it (a hash of the
// address or the browser would be tracking by another name): each human page load draws its own arm at random, so the variants are compared per page view and per draft started
// from each, and one visitor may see both. A browser that still holds the old cookie gets one deletion header (Max-Age=0), which sets nothing.
async function abArm(request, url, env, rnd) {
  if (request.method !== "GET" || url.searchParams.has("v")) return null;
  if (pageSource(request) === "crawler") return null;
  const share = await abShare(env);
  if (share <= 0) return null;
  const arm = (rnd || Math.random)() < share ? "2" : "1";
  const cookie = abCookieArm(request) ? AB_COOKIE + "=; Path=/; Max-Age=0; SameSite=Lax; Secure" : null;
  if (arm === "2") {
    const to = new URL(url.toString());
    to.searchParams.set("v", "2");
    return { arm, cookie, redirect: to.pathname + to.search };
  }
  return { arm, cookie, redirect: null };
}
async function countPageView(env, path, source) {
  if (!env.IPATENT_DB) return;
  try {
    if (!PV_READY) {
      await env.IPATENT_DB.prepare("CREATE TABLE IF NOT EXISTS page_views (day TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path, source))").run();
      PV_READY = true;
    }
    await env.IPATENT_DB.prepare("INSERT INTO page_views (day, path, source, n) VALUES (date('now'), ?1, ?2, 1) ON CONFLICT(day, path, source) DO UPDATE SET n = n + 1").bind(path, source).run();
  } catch (e) { console.error("page view count failed:", e && e.message); }
}
__name(countPageView, "countPageView");
// IPATENT-USAGE-1 (2026-10-02, owner question "What are recent ipatent web queries?"): searches and drafts were not
// measured at all. Each one now adds 1 to a daily counter keyed by kind and broad topic (one of FIELD_SUGGESTIONS, from
// the same FIELD_RULES the idea bank uses, or "Other"). The query, title and description are never stored; only the
// topic label is counted, and automated clients are not counted. GET /api/metrics serves the 7d and 30d totals.
var USAGE_READY = false;
function usageTopic(text) {
  const t = String(text || "");
  for (const r of FIELD_RULES) if (r[1].test(t)) return r[0];
  return "Other";
}
async function countUsage(env, kind, text, ua) {
  if (!env.IPATENT_DB || !ua || PV_BOT.test(ua)) return;
  try {
    if (!USAGE_READY) {
      await env.IPATENT_DB.prepare("CREATE TABLE IF NOT EXISTS usage_counts (day TEXT NOT NULL, kind TEXT NOT NULL, field TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, field))").run();
      USAGE_READY = true;
    }
    await env.IPATENT_DB.prepare("INSERT INTO usage_counts (day, kind, field, n) VALUES (date('now'), ?1, ?2, 1) ON CONFLICT(day, kind, field) DO UPDATE SET n = n + 1").bind(kind, usageTopic(text)).run();
  } catch (e) { console.error("usage count failed:", e && e.message); }
}
async function handleMetrics(env) {
  const out = { ok: true, worker: "qnfo-ipatent", version: VERSION, windows: {} };
  for (const d of [7, 30]) {
    const w = { views_human: null, views_search: null, views_qnfo: null, views_referral: null, views_direct: null, views_crawler: null, guide_views_human: null, drafts: null, drafts_saved: null, drafters: null };
    try {
      const rows = (await env.IPATENT_DB.prepare("SELECT path, source, SUM(n) AS n FROM page_views WHERE day >= date('now', ?1) GROUP BY path, source").bind("-" + (d - 1) + " days").all()).results || [];
      let human = 0, guide = 0; const by = { search: 0, qnfo: 0, referral: 0, direct: 0, crawler: 0 };
      rows.forEach((r) => { const n = Number(r.n) || 0; if (r.source in by) by[r.source] += n; if (r.source !== "crawler" && r.source !== "internal") { human += n; if (r.path === "/guide") guide += n; } });
      Object.assign(w, { views_human: human, views_search: by.search, views_qnfo: by.qnfo, views_referral: by.referral, views_direct: by.direct, views_crawler: by.crawler, guide_views_human: guide });
    } catch (e) { w.views_error = "page_views not yet created"; }
    try {
      const s = await env.IPATENT_DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN title <> '[private]' THEN 1 ELSE 0 END) AS saved, COUNT(DISTINCT ip_address) AS u FROM submissions WHERE created_at >= datetime('now', ?1) AND COALESCE(status, 'draft') <> 'automated'").bind("-" + d + " days").first();
      Object.assign(w, { drafts: Number(s && s.n) || 0, drafts_saved: Number(s && s.saved) || 0, drafters: Number(s && s.u) || 0 });
    } catch (e) { w.drafts_error = String(e && e.message || e).slice(0, 120); }
    try {
      const u = (await env.IPATENT_DB.prepare("SELECT kind, field, SUM(n) AS n FROM usage_counts WHERE day >= date('now', ?1) GROUP BY kind, field ORDER BY n DESC").bind("-" + (d - 1) + " days").all()).results || [];
      const usage = { searches: 0, drafts: 0, searches_by_topic: {}, drafts_by_topic: {} };
      u.forEach((r) => { const n = Number(r.n) || 0; if (r.kind === "search") { usage.searches += n; usage.searches_by_topic[r.field] = n; } else if (r.kind === "draft") { usage.drafts += n; usage.drafts_by_topic[r.field] = n; } });
      w.usage = usage;
    } catch (e) { w.usage = { measured_since: "2026-10-02", note: "no search or draft counted yet" }; }
    out.windows[d + "d"] = w;
  }
  return json(out);
}
__name(handleMetrics, "handleMetrics");
// SUPPORT-MAP-1 (3.6.0): a provisional secures priority only for what it describes (35 U.S.C. 112(a)). After drafting,
// every claim element is matched, deterministically and at no model cost, to the numbered specification paragraph that
// shares the most of its distinctive terms. Elements with no paragraph covering most of their terms are flagged, so the
// inventor sees exactly what the description must still say. This is a lexical check: a "supported" verdict means the
// words are there, not that a court would find written description or enablement. The paragraphs are numbered [0001]
// in USPTO style, and the same numbering is used by the map, the page and the downloadable document.
var SM_STOP = new Set(("a an the and or of to in on for by with from into onto at as is are be been being this that these those " +
  "said wherein whereby comprising comprises comprise including includes include having has have configured adapted " +
  "operable claim claims further least plurality each first second third one more such which where when thereof therein " +
  "according embodiment embodiments invention present method system apparatus device means step steps based using use " +
  "used via can may also other another respective respectively portion portions element elements unit units within " +
  "between about substantially approximately wherein’s its it their them they than then there herein").split(/\s+/));
function smTokens(text) {
  return Array.from(new Set(String(text || "").toLowerCase().replace(/[^a-z0-9À-ɏ\s-]/g, " ").split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !SM_STOP.has(w) && !/^\d+$/.test(w))
    .map((w) => w.replace(/(ies)$/, "y").replace(/([^aiosu])s$/, "$1"))));
}
__name(smTokens, "smTokens");
// Sections 2-5 -> numbered paragraphs. A block with no blank-line breaks over 600 chars is split every 3 sentences.
function specParagraphs(sections) {
  const out = [];
  const keys = [["technical_field", "Technical Field"], ["background", "Background"], ["summary", "Summary of the Invention"], ["detailed_description", "Detailed Description"]];
  keys.forEach(([k, label]) => {
    const raw = String(sections && sections[k] || "").trim();
    if (!raw) return;
    let parts = raw.split(/\n\s*\n|\n(?=\s*(?:[-*•]|\d+\.)\s)/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 1 && parts[0].length > 600) {
      const sent = parts[0].match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [parts[0]];
      parts = [];
      for (let i = 0; i < sent.length; i += 3) parts.push(sent.slice(i, i + 3).join("").trim());
    }
    parts.forEach((t) => out.push({ n: out.length + 1, section: label, key: k, text: t }));
  });
  return out;
}
__name(specParagraphs, "specParagraphs");
function paraNo(n) { return "[" + String(n).padStart(4, "0") + "]"; }
__name(paraNo, "paraNo");
// Claims text -> [{claim, element}]: the preamble before "comprising:" is dropped; the body splits on ";" and new lines.
function claimElements(claimsText) {
  const claims = [];
  let cur = null;
  String(claimsText || "").split(/\n/).forEach((line) => {
    const t = line.replace(/\*\*|__|`/g, "").trim();
    if (!t) return;
    const m = t.match(/^(\d+)\s*[.)]\s*(.*)$/);
    if (m) { cur = { claim: Number(m[1]), text: m[2] }; claims.push(cur); }
    else if (cur) cur.text += " " + t;
  });
  const out = [];
  claims.forEach((c) => {
    let body = c.text.replace(/^the (method|system|apparatus|device|medium|composition|process)[^,]*of claim \d+[^,]*,?\s*/i, "");
    const ci = body.search(/\b(comprising|consisting of|including|wherein)\b\s*:?/i);
    if (ci >= 0 && ci < 220) body = body.slice(ci).replace(/^(comprising|consisting of|including)\s*:?\s*/i, "");
    body.split(/;|\n|\.\s+(?=[A-Z])/).map((e) => e.trim().replace(/^(and|or)\s+/i, "").replace(/[.;,\s]+$/, "").trim())
      .filter((e) => e.length >= 12).forEach((e) => out.push({ claim: c.claim, element: e.slice(0, 400) }));
  });
  return out;
}
__name(claimElements, "claimElements");
var SM_SUPPORTED = 0.6;
var SM_WEAK = 0.35;
// VALUE-CHECK-1 (3.7.0): a live run showed a claim adding "0.5 N\u00b7m to 2.0 N\u00b7m" rated supported because the words
// matched. A number in a claim element that appears nowhere in the specification now makes the element unsupported.
function smNumbers(text) {
  return (String(text || "").replace(/claims?\s+\d+/gi, " ").replace(/\(\d+\)/g, " ").match(/\d+(?:[.,]\d+)?/g) || [])
    .map((n) => String(Number(n.replace(",", ".")))).filter((n) => n !== "NaN");
}
__name(smNumbers, "smNumbers");
function supportMap(claimsText, paragraphs) {
  const paras = (paragraphs || []).map((p) => ({ n: p.n, tok: new Set(smTokens(p.text)) }));
  const specNums = new Set(smNumbers((paragraphs || []).map((p) => p.text).join(" ")));
  const rows = [];
  claimElements(claimsText).forEach((ce) => {
    const tok = smTokens(ce.element);
    if (tok.length < 2) return;
    let best = null, bestCov = 0, missing = tok;
    paras.forEach((p) => {
      const hit = tok.filter((w) => p.tok.has(w));
      const cov = hit.length / tok.length;
      if (cov > bestCov) { bestCov = cov; best = p.n; missing = tok.filter((w) => !p.tok.has(w)); }
    });
    const missingValues = smNumbers(ce.element).filter((n) => !specNums.has(n));
    let status = bestCov >= SM_SUPPORTED ? "supported" : bestCov >= SM_WEAK ? "weak" : "unsupported";
    if (missingValues.length) status = "unsupported";
    rows.push({ claim: ce.claim, element: ce.element, paragraph: best, coverage: Math.round(bestCov * 100) / 100,
      status, missing_terms: missing.slice(0, 6), missing_values: missingValues.slice(0, 6) });
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  return { method: "distinctive-term overlap with the best numbered paragraph, and every number in a claim must appear in the specification; a check on wording, not a legal opinion",
    elements: rows.length, supported: count("supported"), weak: count("weak"), unsupported: count("unsupported"), rows };
}
__name(supportMap, "supportMap");
// Global daily cap (COST-GUARD-1): every draft is one long reasoning-model call; the per-IP limit does not bound the total.
var DAILY_DRAFT_CAP = 150;
// IndexNow (INDEXNOW-1): the key file proves ownership to Bing, Yandex, Seznam and Naver; Google does not use IndexNow.
var INDEXNOW_KEY = "7f3c9a1e5b2d4086a1c3e5f7092b4d6e";
// EXAMPLE-1 (3.7.0): one real, unedited run (2026-10-02, gpt-oss-120b, 39 s), rendered at /example with the live support
// map and a plain list of what the run got wrong. The page is the honest demonstration: useful structure, invented facts.
var EXAMPLE_INPUT = {"title": "Folding drawer hinge with torsion spring", "technical_field": "Furniture hardware", "description": "Conventional drawer hinges protrude and waste space in narrow cabinets. The hinge comprises a steel mounting plate fixed to the cabinet frame with two screws, a 6 mm stainless steel pivot pin passing through a sleeve on the plate, and a torsion spring wound around the pin that biases the drawer front closed. When the user pulls the front past 90 degrees it folds flat against the cabinet side. Alternatively the pin may be brass and the spring may be replaced by an elastomer bushing. FIG. 1 shows the hinge closed; FIG. 2 shows it folded."};
var EXAMPLE_SECTIONS = {"title": "Folding Drawer Hinge with Integrated Torsion Spring", "technical_field": "The present disclosure relates to furniture hardware, and more specifically to a hinge mechanism for drawer fronts that permits the front to fold flat against a cabinet side while providing a biasing force to close the drawer.", "background": "Conventional drawer hinges are mounted on the exterior of a cabinet and protrude from the cabinet face, consuming valuable interior clearance in narrow or high\u2011density cabinet assemblies. In many cabinet configurations the hinge geometry limits the maximum opening angle of the drawer front, restricting ergonomic access. A need therefore exists for a compact hinge that occupies minimal space, allows the drawer front to lie flush with the cabinet side when opened, and automatically returns the front to a closed position.", "summary": "The invention provides a compact folding hinge comprising a steel mounting plate secured to a cabinet frame, a cylindrical pivot pin extending through a sleeve on the plate, and a torsion spring wound about the pin that biases the drawer front toward the closed position. The pivot pin may be fabricated from stainless steel (\u22486\u202fmm diameter) or brass, and the torsion spring may be replaced by an elastomeric bushing to achieve a comparable restoring torque. When the drawer front is pulled past approximately ninety degrees, the hinge folds such that the front lies substantially coplanar with the cabinet side, thereby eliminating protrusion. The hinge is installed with two screws, and the spring or bushing is pre\u2011loaded during assembly to provide a predetermined closing torque. The disclosed hinge achieves a reduced profile, a simple two\u2011screw attachment, and a self\u2011closing action without additional actuators.", "detailed_description": "The hinge assembly includes a planar mounting plate (10) formed of cold\u2011rolled steel, having a centrally located cylindrical sleeve (12) of internal diameter matching the outer diameter of the pivot pin (14). The mounting plate is affixed to the cabinet frame (16) by two self\u2011tapping wood screws (18) spaced to align the sleeve with the hinge axis. The pivot pin (14) is a solid rod, preferably stainless steel, 6\u202fmm in diameter and 30\u202fmm in length, extending through the sleeve and projecting outward on both sides of the plate. A torsion spring (20) of rectangular cross\u2011section is wound around the exposed portion of the pin; one end of the spring is anchored to a retaining collar (22) fixed to the plate, while the other end is fixed to a second collar (24) that rotates with the pin. During assembly the spring is pre\u2011twisted to store elastic energy, thereby generating a clockwise torque that urges the drawer front (26) toward the closed position. An alternative embodiment replaces the torsion spring with an elastomeric bushing (28) positioned within the sleeve; the bushing is compressed during assembly to provide a similar restoring torque. When the user pulls the drawer front beyond a ninety\u2011degree angle, the pin rotates within the sleeve, allowing the front to fold flat against the cabinet side (30). The hinge returns to the closed orientation when the user releases the front, as the stored spring or bushing energy drives the pin back to its neutral position. The entire assembly occupies a thickness of less than 12\u202fmm, permitting installation in cabinets with limited clearance.", "claims": "1. **An apparatus comprising:**  \n   a mounting plate having a planar surface adapted to be fixed to a cabinet frame and a cylindrical sleeve extending from the planar surface;  \n   a pivot pin extending through the sleeve, the pin having a first end and a second end extending outward from opposite sides of the plate;  \n   a torsion spring wound about at least a portion of the pivot pin between the first end and the second end, the spring being pre\u2011loaded to bias the pivot pin toward a first angular position;  \n   wherein the apparatus is configured such that when a drawer front attached to the pivot pin is rotated past approximately ninety degrees relative to the cabinet frame, the drawer front folds substantially coplanar with the cabinet side, and the stored energy in the torsion spring returns the drawer front toward the first angular position when external force is removed.  \n\n2. The apparatus of claim 1, wherein the mounting plate is fabricated from steel and the pivot pin is fabricated from stainless steel having a diameter of about 6\u202fmm.  \n\n3. The apparatus of claim 1, wherein the torsion spring is a rectangular\u2011cross\u2011section spring having a calibrated torque of between 0.5\u202fN\u00b7m and 2.0\u202fN\u00b7m.  \n\n4. The apparatus of claim 1, further comprising two screws for securing the mounting plate to the cabinet frame.  \n\n5. The apparatus of claim 1, wherein the torsion spring is replaced by an elastomeric bushing positioned within the sleeve, the bushing being compressed during assembly to provide a biasing torque.  \n\n6. The apparatus of claim 5, wherein the elastomeric bushing is composed of silicone rubber having a Shore A hardness of 40\u201360.", "abstract": "A compact folding hinge for drawer fronts is disclosed. The hinge includes a steel mounting plate fixed to a cabinet frame by two screws, a cylindrical pivot pin that passes through a sleeve on the plate, and a torsion spring wound about the pin to provide a biasing torque that closes the drawer. When the drawer front is pulled past approximately ninety degrees, the hinge folds so that the front lies substantially flat against the cabinet side, eliminating protrusion and conserving interior space. Alternative embodiments replace the torsion spring with an elastomeric bushing to achieve comparable restoring force. The hinge occupies less than 12\u202fmm of thickness, can be installed with standard hardware, and is suitable for narrow\u2011width cabinets where conventional hinges waste valuable space. The disclosure also provides a method of assembly, a system incorporating the hinge, and a computer\u2011readable medium containing instructions for automated manufacturing.", "declaration": "I, [Inventor Name], hereby declare that I am the original inventor of the subject matter recited in the foregoing provisional patent disclosure and that to the best of my knowledge, the invention is novel and has not been previously disclosed, described, or claimed in any patent, patent application, or other public document.", "support_gaps": "- Exact material specifications for the elastomeric bushing (e.g., durometer, dimensions) are not fully described; additional data needed for a skilled artisan to select an appropriate substitute.  \n- No quantitative relationship is provided between the number of torsion\u2011spring turns and the resulting closing torque; calculations or tables would aid enablement.  \n- The method of pre\u2011loading the torsion spring during assembly is described only qualitatively; a step\u2011by\u2011step procedure (e.g., torque wrench values, fixture design) is absent.  \n- Drawings referenced (FIG.\u202f1, FIG.\u202f2) are not supplied; the disclosure should include:  \n  * FIG.\u202f1 \u2013 exploded view of the hinge components in the closed position;  \n  * FIG.\u202f2 \u2013 side view showing the drawer front folded flat against the cabinet side;  \n  * FIG.\u202f3 \u2013 cross\u2011section illustrating the elastomeric\u2011bushing embodiment.  \n- The claim set includes a computer\u2011readable medium, but the inventor\u2019s description does not provide any software logic or algorithmic detail; further elaboration would be required to satisfy written\u2011description support.  \n- No discussion of tolerances for the sleeve\u2011pin fit or the effect of wear over time; these parameters should be defined to ensure reliable operation.  \n- The protective coating mentioned in claim 14 is not described (type of coating, application method).  \n\nIf any of the above items are unavailable or unnecessary, the inventor should confirm so that the provisional application can be refined accordingly."};
var EXAMPLE_META = { date: "2026-10-02", model: "@cf/openai/gpt-oss-120b", seconds: 39 };
var OG_JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCAJ2BLADASIAAhEBAxEB/8QAHQABAAMBAQADAQAAAAAAAAAAAAYHCAUEAgMJAf/EAGMQAAEDAwIDAwYGCQ8JBQYGAwEAAgMEBREGEgchMRNBUQgUImFxgRUyN5GhsxY2QnJ0dYOxshcYIzM1UlZic4KSwcLR0iRmk5SVoqW04yU0Q1NVJjhUo8PhJ2N2hKTTZPDx/8QAGwEBAQEBAQEBAQAAAAAAAAAAAAECAwQFBgf/xAAyEQEBAAIBAwIEBAYDAQEBAQAAAQIRAxIhMQRBEzJRcQUzYbEUIoGhwdEjkfBS4ULx/9oADAMBAAIRAxEAPwCrMJhf1Fh+P01hwN+S2yf/ALj/AJiRTtQXgd8ltk//AHH18inSxX6z035OH2n7CIijuIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgwrhML+otbfj9NX8Dvkusv8A+4+vkU6UF4H/ACXWX8v9fIp0o/Ven/Kx+0/YREUdhERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREGF0X9wmFX5HTVvA/5LrL+X+vkU6UG4IfJfZfy/18inKj9R6f8rH7T9hERHYREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERBhnCYX9wmFH5PTVnBD5L7L+X+vkU5UG4I/JhZfy/18inKr9N6f8rH7QRER2EREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBEXEv2t9N6ZyLveaOleBkxF+6T+g3LvoRnLKYzeV07aKqLn5SGlKR5ZRUlyr8fdtjbGw/wBI5+hcWbyn6ZpPY6XmeO7fWBv5mFXVebL13BPOS8UVHReU/TkjtdLSsHfsrQ7+wF3rZ5RmkKxzWVkNyt5PV0kIewe9hJ+hNUx9dwZeMlpouNYtZ6d1KB8EXijq34z2bJAJB7WHDh8y7Kj045TKblEREaEREBERAREQEREBERAREQYbwmF/UWNvyumquCPyYWX8v9fIpyoPwS+TCy/l/r5FOFuP0nB+Vj9oIiI7CIiAiIgIihHFHUt609BY4rHPTwVFyuMdEXzR72tDwRnHtwqxyZzDG5VN0ULoLVxGjrqd9bqKyy0jZWmaOOiLXPZkbgDnkSM81NEMM7l5mhFUekL5xL1jZJLzb7rY2tbNJE2nqKVw3Fp73N8VNeHWsX62078IVFKKSrgnfS1MLTlrZG4zj1YIP9/VNOXH6jHOySWb8JOihvFbU100rpqGttEkMdVLWRU+6Vm9oDs55e4L6IrRxNEjDJqWxOYCNwFCQSO/vTTWXNrK4yW6TlEVYU971zqTV+pbXZrtbKKltE8cbRUUu8uDwSOY+9PzovJyTDU1vaz0XC0vR6npBU/ZJc6CvLtnYeawGPZ13Zz1z6PzFd1RvG7m9aEREaEREBERARFX+uNQ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337NdOQa/rKaezuqg+ifQM7OHzsfEbKHZPPu54+nE81ho77K6iyTefea/BVwjrsdlv7XYc7Oo258efsX3a10pBrTT1RaJpjTukLXxVDW7nQyNOQ4DI9nUciU2cnBlllllP019Lp3VW3DQ9lr3iBBMcVJropMHkTGQ/b7gCPnCsK3w1FNQ08NXUiqqI42tknDNnauAwXbcnGeuMqMai0JPXX5morDeZbJd+y7GaQQiaKojHQPYSASOXP+4KR25ccrcc5PHt/RLlDeMXyaX3+Rb9Y1dPS9m1BbZque/ai+F3zhgjjZStgjpwN2cAE5zkczz5BfdrHTv2Waar7J515r52wM7bs9+zDgfi5GeninuvJvPiymu9lQ6waK1bPYrbLDxDroIn0sTmRCgiIjBYMNyeuOisiFjo4mMe8yOa0AvIxuPioDS6G15RUsNLT8S9kMLGxxt+A4DtaBgDJdnoFOaGKop6Knhq6nzqojia2WfYGdq8AAu2jk3JycDplKzwY9Pbps+93/AJr70RFHoEREBERAREQFAuLnEqPQNmEVI6N94rARTsdz7NvfI4eA7h3n1AqZXa6UtktlVcq2Ts6alidLI71AZ5eJ8AqK4b2Wp4r67rtaX2Hdb6WUdjC7mwvHxIx4tYME+JI8SrJ7vJ6rlymuLj+bL+0+qRcH+FstI8av1Q11Rd6o9tBHP6Tod3PtHZ/8Q/7vt6W8iJbt24eHHix6cRERR1EREBERAREQFUPGDhbLVPOr9LtdT3elPbTxwei6bbz7RuP/ABB/ve3rbyKy6cubhx5cenJAuEnEqPX1mMdW5jLxRgCpYOQkHdI0eB7x3H1EKerP/Eiy1PCfXdDrSxRFtvq5T20LeTA8/Hj9QeMkeBB8Ar2tN0pb1bKW5UUnaU1VE2WN3qIzz9fqSuPpeXK74uT5sf7/AKvUiIo9YiIgIiICIiAiIgw/hML+4TC4PzWmp+CfyY2b8v8AXyKcKEcFPkys35f6+RTddp4foOH8vH7QREVdRERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERA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U1TBWU8dRTTRzwStD2SRuDmvaehBHIhfm+tceSdc66t4fVtNUufJT0dwfHTOcc7WljXFg9QLif5y6ZYam4kq7ERFyaEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERBjpF/UXwXDTSfCD5O7T+W+uepiodwh+Tu0/lvrnqYr7fF8mP2dp4ERFtRERAREQERcDXGtrTw/09Pe7xKWxR+jHEz488h6MaO8n6ACTyCo768tTdbfROLKqupYHDqJZWtI+crGOvPKA1lrSeWOCuks1tJOykonlh2/x5Bhzj49B6l5+GXBjUXFSSathmZRW2N+2WvqAXb397WDq88+fMD1rfw9TdZ22zTV1JWZNNVQT45/scgd+Zfes0XHyQa2mp+1s+ro5atjSWsnpDE1zu70mvcW/MVWT9b8TOFt7ns019udHVUjg19NUS9vFjGQQ1+5uCCDkeKTCXxTbcirPykPkcvv31N/zEanmna2a46ftlbUEGaopIZpCBgFzmAnl7SoH5SHyOX376m/5iNZx8xb4YnWqPJC+1S+/h7fqwsrrVHkhfapffw9v1YXbk+VmeV+Iixhxf1frC+cSrvp6G8XOaBle6kpKGCUtYcu2taGtwHHuyclcccdtW6bInr6Ol/7xVwQ4/8AMkDfzr66e8W2qcGU9wo5nE4Ajma4k+4rNdi8kK51VMya+amp6KZwy6CmpzPtJ7i8ubz8cAj1rgcQ/JlvujLPPebbc4b1R0rDJUNEJhljYOrg3c4OAGSeefUtdOP1Tda+RYH0pxT1joydklpvlW2JpBNNM8yQv9RY7l7xg+ta84Q8VaPilYH1TYm0tzpC1lbTA5DXHOHN/iuwcZ5jBHdkzLCxZdp4uZqXTlt1bZKuy3enE9HVM2vbnBHeHA9xBAIPiF01kXX/AAn4k6XoLvqarvrRboJTKWxXCUvDXSANAbgD7od6mM2VL5PI9pDcS6PV07aHdns3UQMoGem7eBnHft9yvPSOkrVoiw01js0BipIAcFxy+RxOS5x7yf8A7dAsDfZPff8A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Bemv9mQf4U/Uz0N/AvTX+zIP8KkiJujm2bTNi0723wLZbbbO329r5nSsh7TbnG7aBnGTjPiV9l0sVpvcfZ3W10NwZjG2qgZKMexwK9yIqB1/AjhtcnF02k6NhPP9gfJD+g4Lzw+T1wxgOWaWjP39XUO/PIVYiJ1VNI7YuHekdNSie0actlJO3pMyBpkHscckfOpEiIoo3qrhxpPW72SagsdLXSxja2U7mSAeG9pDserKkiIOPprR9g0dSOpLBaqa3wvO54ib6Tz4uceZ95XYREBERQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREGQkX9wmF+aa00bwk+T21flvrnqXqIcJPk+tX5b656l6/Q8P5eP2jIiIugIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgyKiIvzG3TTRnCX5PrV+W+uepcojwm+T+1flvrnqXL9Fwfl4/aOdERF1BERAREQFHtXatfpKmdWSWauraSOMyTT05jDYhnHMOcD8wUhUV4qfJ7fPwY/nCuPlK9GkNXv1dTtq4rNX0VHJH2kVROY9svPGAGuJ8eoXz1ZquTSlKax1mrq6ljjdJNNTuYBCB47nA/NleHhL8nVj/kT+m5ffxM+0C/fgj1dTq0ezoacvk9/ozVS2mstzCGujFSWEytIyHDa48vauJPxGZV3Optum7LXX+ekdsnkgcyOCN373tHkAnr08F37E1z9OW9rXFjjRxAOHcdg5qnuFmuKHh4K/SmqY5bdUNq3SidzCWkkNbh2OePRBDsYIPcrJvabTiTimbVcqWg1Hpq6Wd9W8Rwyksmic4nGNzT6x0yp2o/VQac1/QQtZWU9wgp52VLHU0wcWSN6Zx07+RUgUulEXkupuLaGQ2llI+s5dm2qe5sZ5jOS0E9M93VV7pviVqXVNTcbVQWW3/CVFMY5JXzPFNE0Ejc443EkjAAHcScYSY2m1moq/pNf3uyaqpNO6xt9DAa/lSVtC93YvdnG0h3Mc8D1Ejlg5Xp4kaxv2iKM3SmobZU24OZF+ySvE2857gNuOXinTd6Npuiru56v13UWR+oLFY7ULa2LtmR1bpHVE8YGd7WNwACOYBOcY5dy9t84iy2qhsdLTW4VmobzDG+KiDtjYy5oyXk8w0En5jzGE6abTdFAr3qfWmj6EXe9W6zV9tjc3zltudI2WFpONw38nAEjw9w5r26p1hc6LS0WptOUtDcbeIPOJRNI9smw4wWgDHIFxdkjGE6abTBFHND366am0/Hd6uK2sbVMD6cUsj3Y6gh+5owQ4YOM9CuZpzU2rL1eLnRSUNjEFtkNPNPFPKQ+bsyQ1mWc9ri0OzjGeWU6Tbq2jWtLd9VXTTsVHWRT21oc+aRgEb846c/Xy8RlSFQfTetr1W67rtJ3iht8UtJSecmWkke9pJMeB6QHc/w7l99+1lczquPSenKSjluAg86qJ617hFDHkDGG83E5Hzj14XHubTFR7VGtaXStws9FUUdZUPus/YRugYCGHLRz5/xhyHcD4Lk/ZPquyajtVqv1Baqilukhiiq6Bz2dm8AnDmvz4ePvX1661tf9G19G7zC1z26tqmU0Lu1k7YZAyXDG0c84wT3KzHubTtFytUakodJWSou9wc7sYQMMbjdI48g1vrKjdBeeIV3tTLvS2uwU8UzO2hoqiSUzuYRluXjDQSMd3fzwsyG05RRjRutota2epqKSn81uNK4wz0k7v2qXHLJHPaT347jy5KNR8StSQ6wqdJ1Nkt89ybCHQ+azv7NzyGuy5zmjDQwuJOM+jgdVemm1mIq6fr3UumdSW216vttrbS3R/ZQVdvkeWsdkDDg/meZGenXPPBUs1ffanTlgqLjR299xqI3MZHTtcQXlzw3qAemc+5Omm3ZX1VjqhlJM6kjjlqAxxiZI7a1zscgTg4Ge/Ch9VcuIVst0lzqaHTtUyFhlko6d8rZdoGSGvOWl2PV86kOmNRUeq7HS3ih3CGobnY74zHA4c0+sEFNa7m3A0jrm43zVF109crZT0c9tja574JzI1xOOQy0dxUzVX6K+WXWX8lH/AGFaCZTuQXju0txhonvtVNT1NUCNsc8pjYRnn6QB7vUuZrfWNHoewyXWrY6U7hHDC04Msh6DPcORJPgCuJQX3iCKFl3uFjs7qMtEr6KnlkFW1mM5GcsLsc9uR4dUk9zb28O9bT62oq+aooY6OSjqTTFrJC8OIAOckDxXsZrWlfraTSYo6wVLKcVBn2DsiMA9c5xzxnx5KG8AZmVFpv00ZyyS5Oe046gtBC7FHra/0+v6PSd4oLW01VO6pE1JLI/DQH4HpAc8sWrj3qb7J2iiWrNZVtsvtt01ZKOnqbvcWuka6qeWwwxtBJc7HM/FdyHgvDctT6x0vW2z4aoLNXUFdVR0ZmoXSRuhe84BIfuyOvzdyz01dp2ijOudb0+jaOmxTPrbjXSdhR0jCAZX+s9wyQPeFy7ndeI1ptMt1lodOVDYGGWWjhdN2oYBkgOJwSB6u7llJibSDVl1u1ltklfbKGlrG08b5p2zzmLaxrc+jhpyeR5cl9ehdTP1hpejvclM2ldUGQGJr9wbte5vXA/e5Xkqr0NR8M6y7iAwCrtU0vZF27ZmN3LOBlc/gl8mlp9s/wBc9XXY905RQOk1zetXXeuo9IUdvNDQP7Ka417nFkj/AAjazmRyznPTw5Z+61a6uFJqpmltVUVLSV1SztKSqpHkwVA58vS5tdyPI/3ZnTTabIohqjWVfRajoNLWKkpqi7VkRqDJVvLYYIxnmdvMk7XcgvJWan1fpu7WmC90FnrKG5VcdGKihdJGYZHnlua/OR16eHcnTTadIoJxG1tftDNhroqC2VNunnZTs3SvE28tJJIxtx6J7/BSPVVddrZaJa20Q0Mz6drpZW1cj2Ds2tJO3aDl3IdcD1po27CKMaI1TW6x0dHem01PBWTCURxFzuz3NcWtyeuOQyo1T8S9R/ZZW6TlslBUXWFjey82nf2RcQ1xc5zgCGhrsnlknAHVOmm1mIoRZNRayi1d8D6loLTFRvpH1LKqh7QsG0gYLnHrz8AvptOttQa2qayTSlHbobVSydiK2473ecPHXY1hGBjHU949gdNNp6ih+m9cVVTqSq0rqCihorvCztYnQPLoaqP98zPMH1eo+BCmClmgXju0txhonvtVNT1NUCNsc8pjYRnn6QB7vUuZrfWNHoewyXWrY6U7hHDC04Msh6DPcORJPgCuJQX3iCKFl3uFjs7qMtEr6KnlkFW1mM5GcsLsc9uR4dVZPc29vDvW0+tqKvmqKGOjko6k0xayQvDiADnJA8VLVVnAGZlRab9NGcskuTntOOoLQQvRceJWorBq6m05crNb6qoqoe0gbQTPJe4lwY0l7Rjm3mcYA5q3HvZEl7LLRQOPUOvKDVFqobxa7N8G3B7mGWiMr3QkNJw5xIGfdhffBftZ3253KK02600FDQ1L6Vs1wMr3VDmn4zWt24b05+vv5qdK7TVcbV2qaPR1inu9a1744sNbGz40jycBo/8A96Arl6e1nWT6kqNLX+igo7tFF28T6eQuhqY/FuRkEeB8D4KH+UG+7/Y7G18dCLV53Fte2R/bl+x/Itxt29e/PRWY99Ut7JRHrLU9O+2S3PSLIKS4VEUG+Cu7WSn7Q4Be3YOQ78HkpJaNR2q/SVcdtrG1LqOTsZw1rh2b+fLmB4HoubSya182qPOKTTrZRGPNxHUTFpdkZ35j5DbnpnnhVvwpk1U2t1R8FU9ke83A+cedTytAfl3xNrDkdeuE1uJtZ2tNXU2irKbrVUtTUx9q2LZAASC7vOeg5fOQO9dmmnFVTxTta9glYHhrxhwyM4I7iofrnVOpdIWIXltFaJ4IIYvOmmaTcJnODSIxtwWZI5kg9eS7TbheLlpuhuFpgoDW1UMUxjq5HtiaHNBIy0E9/LkprsrtIqx0pxK1RrihqWWazW2Oup5i2WWpleKeNmBt6Dc5xO/kOgbz6hdbRuvLjc9R1+ltRW+norvRs7UOp3kxTM5c255jk4Hr0PdhLjYbThFDtd6+k0zV0FntVCLje7i7EFOXbWtbnG5x8Cc49h5jC8F51drLR9mqLnf7VZ6mFsZ2yW+STEMh+KJGv5lpOBlp5E9MJMabWAijOg79e9TWmK7XKlt1PS1UYfTtppHuk6kHeHAAdO4lSZSzQIq5p9c6ufrY6TqLbYoapsQn7Q1EuyVnInYduScE9QPildDiJxJi0JVWiA07J/PJSZ8uIMUIIBcMd/Pl7Cr03ejabLm6kvsWmrHWXeeCaeKlZvdHCMuPMD+vme4ZXO11qC5aasMl4t0VBPFAN0ramR7S4EgNDNoOSSQOeOq8l4vWr7Rph13koLJ29NFLUVUJnlw1jW7gGHbzd1znA6c0kNu/YLxFqCzUd1hhmhjq4hK2OYYc0HxXxtGo7VfpKuO21jal1HJ2M4a1w7N/PlzA8D0XL03qK6ao0TS3qipqKO4VTC5kMz3CEESFpyQCegPd1Vc8KZNVNrdUfBVPZHvNwPnHnU8rQH5d8Taw5HXrhXp8m0+4gatvGjbdJdaa10lZb4Ws7V0lSWSBzn7QA0NII5jnnxUis9ebpaKGvcwRmqp45iwHO3c0HGfeoXxjNQeFVeatsTanbTdqIiSwP7Vm7aSASM5xkLx2e/62qNJ2+s07ZrW+gpqONjRWyPE9VsYASxrcBoJBA3Hn1701uG+6y0Uc0BrODXWnmXSOHzeVsjoZ4d27Y8YPI94IIPvUjWbNdgRRjU9/v9JeLfZrBa6aonq43yvqqp7hDTtaR8YNGTnPiuZddY6h0XLST6ppbXNa6mYQOrLeXtNO49C5j85byPMHu9gN6abTpEByMhFlRFBI9c3jVF+rrXpCjoH09ud2dTcK9zjGX5I2sazm7oeee7u5Z+yg1bqSg1lQ6a1FbbeRcI5JKetoXvDDsaXOBa7Jzy8e8dVrpqbfG567vNl1ja7DX2ejEFzncyCeKqc52wHAc5u0YOCOWfepyqv4i/Kjob+Vf+k1TLWd/uOn7dTyWq2fCVZVVTKWOIvLWtLgfScQDyGOfTr1Vs8aHeRQe7X3XGmLbJd7nQ2Kvo6cb6iGhdLHKxneWl+Q7HXoFJILs+9aejudhNPM+phEtP5y5zGHPc4tBIxz7uoWdG3i0lrWl1fLdI6ajrKY26o83eahgbvPPpz68uY7sjxUhUM0HrW5amu9/tdzo6Snms8zIS6me5zXuJeDjcAcehy5d65eoOI9/wBLaqorNcLTb6llfuNOKKV7pH8yGNO4ABxOB4DPVa6bvUNrHRVtfNe6u0XU0dZqa0Wn4GqphC59DK90tOTz9IuwHHAJ5DBx1C9d71drFltl1BZbPa5bJFGZmtqJH+czxDn2jQMNaCOYBycd2eSnTTafIuPpHUtPq7T1JeaZhjbUNO6MnJjcCQ5ue/BB5967CiiKH6j1lcYdT0uldP0lJPc5oTUyzVj3Nhgjz3hvNxOOgx3ePLzzan1bp++WmhvtBaaqjudQKZlVQOkjMTzzw5r855A9D3FXpqbThFBNaa3v2kLzb4nUFsmt1xqmU0LxK/tm527i4YwOpxgldzWt3vFhs010tdPQTx0kT5qhtVI9p2NGfQ2g5PXrhOmm3fRR3TOoLhqfRlLeaenpY66qic5kUj3CIODiACQCccvBRW1cStSXLUNz0yyyW+W7Uh2tdHO8QNAPpPe4jO0ZaMAZJKdNNrMRV1V6/wBRaQvdDR6yt9sbb69/ZxV9ue/ZG7I+OH8+WefTlzGcELrcQ9T33R9rlvNDR22pt9O1naieV7Zt7nho2gDBHMdSO9Omm0vRQOh1PrfU1pgu1gtNmgpZImuaLhLJ2lQ7HpbA3k1ucgFx54B6Fe/QGvG6xhrKaqpDQXa3SdlV0pdnackZafDII9RHsJdNNpaihFdrq5XPVNRpnSdFSVNRRDdWVlY8iCA/vQG83Ozy9oPgSPrk1zeNMX6hter6OgZT3F3Z01woHOEQfkDa9r+beo557+/nh002naKIcRNUX3R9slvFDR22pt8DWCUTSvbNvc/b6IAwRzHUjvXJdrHXF6sDb7p6yWptIIO0Da17zLUED0jGxuMDOQNxycZ7wkxvk2ml61HatOxwSXWsbStqJBDEXNcdzz3cgV0VRnE+66hvOn9MXCupLdTw1FTDLGxr5BKJSzm17SMBuc9CT0Vs2V+qXVTxfKeyx03ZnaaKeV79+RjIcwDGM9/grcdTZt2kRFhRERAREQEREBERAREQEREBERAREQEREBERAREQEREGR8Jhf1F+W27aaJ4TfJ/avy31z1LlEeE/yf2r8t9c9S5fpOD8rH7RxvkREXUEREBERAUa4l076nQN9jjBLhSPfgeDfSP0BSVfGWNk0b4pGNex4LXNcMhwPUFWXVRDeDdXHV8ObRscCYmyRPA+5IkdyPuwfevv4sVcdHw9vTpHAdpD2TQe9znBoA+dcSj4X3vS1VUP0dql1vop37zQ1VOJo2n1En2DOM4AySvfFoC73i4UtVq7UhutPSSCaKggpxDB2g6F2Dl+PA/mJC323vae2kutEDqS0UUEgw+KnjY4eBDQCuLBT6W4lWSnuctup6+lmDhG+eECRuHFpGereYPQqSkZGFXdh4b6h0ZFLT6c1YzzN7y8UtdRiRrT47g4EH2ABZiojxK0JS8No6TVmk6me3yxVDY3QGQuacgnkSckcsFpJyD6ldlFO6qoqeoewxulja8tP3JIzhQmq4c3LU9XSzaxvwuNLSvEsdvpacQwl/i45JcO7u7/ABKngGBgK5XchIKq+Cbo/hbWbQR2vwjl33u6TH9atRUnw1sFdcLtqm4Wi6OttxguUkYe6PtYpYy5xLHsJHeAQQQRzTHxUvl0ePYMk2lYoBmrfWu7EDrnLB+ctXT4/faA78Li/tLpWvh9Vz6jg1Jqm7i611KMUsMUPZQU/rAydx9Z+nAx8uIGgrnrqIUY1E2ht3ouNN5kJCZG59LfvB7+nqVlks/QSu1sbHbKRjRhrYGADwG0Kr7kXReUNa3VI9CShIgJ6ftcn9e751YOmrVeLTTPhu17Zdj6Iic2kbB2bQMY5E5Xk1homk1a2ln85moLlQv7SkrYPjxO5HmPuhyHJSXVWvs4gPij0Nf3S42m3zgZ8SwgfSQuDwcpHVHC+gpq6MPhmE7djh8aN0j+R9RyfcV87loXUOqII7fqTU0U1rY4GSChpOxfV4ORvcXHHPHIDHLxU1pKSCgpYaSmibFBAxscbG9GtAwAPcm9TR7qe0TqU8OKXVum7g7e+zF1VRB/WVrsBo95dGf55Vj6EsUmn9MUlNUkurZc1NW89XTyHc/PsJx7ly9ScMaDUesbZqSWp7M0e3tqcRZFTsO5mTnlg9eRyAAphUMkkgkZDKIpXNIZIW7tjscjjvx4JlZSRWVk/wDeAv8A+K2fmgXT1hoAah1C29WC/m03+kjayQxkPBac7d7QcjIz1yCB0XnpOGWo6TU8+pG61jNxqYhBM/4KZhzBt5Y7TA+I3nhdi46NubNTVOo7FfBR1NVEyKemqaftoJQ0Yb0LSCPHPj4q779qiNUuttY6N1DbbJrOno62luMohguNL6JLiQOY5DkSMjaOueeF8uOv/ddN/jRn5l3ToWvvd7t941Tdoat1tf2tLSUcBhhZJkHcSXOc7mB4dPavPrfh1d9Z10cj9UMpaOnmbPTU3we15ieGgZL94LueTzHeks3KOL5RTJ3aPoHMBMLa9pkx3Hs34Ps6/OFaNPJHLTxSQ47NzA5mOmCOS47tNvuum5bLqWsbd+3BbLM2EQbhnLcNBOCOXP1LhUmjNW2q3CzW7WEbbc1uyKWei31MEfQMa7cAeXeRy5YU7WaVH+Fe6XiTrqWAf5L5y5riOhf2r8fmcvRZmNd5QV+JGS21sI9RxAP61M9L6PodH2V9ttT5BJIXSSVMvpvklIxvd493JRmi4Z6ho9Uzal+zON9fURthnd8FNAfGNvo434HxBzAV3Lamni43gdtpN3eLo3B97V3uK2tqnRGnGVNBGx9bVTCnhLxlseQSXEd+Mch4n1Lz634dXbWVygqDqdlJS0srZ6Wm8wa8xPAGSX7wXZIJ5jvwujftC/ZZpNlkv9yNXVsf2ra+KBsRDwTghgJHxTtIzz9RTc7bHLdonUPwTJNdNdXd9SIXOlbTtjjizjJAG3p3Z/MvNwBJOgGgnpVygerovdDpDWNRQmz3TVsM1uMZifLDSbamVmMbS4kgZHUjJ9eea/mjOHt60Zbqi3UuqmS0z45OxYbc0GKZ2MSZLyXYx8XoUt7a2OTor5ZdZfyUf9hWgq8s/DS/2jUtTf26xjkqa1zPOh8FtAlaCPRHp4bkDGQFYazlr2WKl4/BzW6ZlkH+SMrXdrnpn0SM+4OVtZAGSeXiuTqnTFv1fZprTcmuMMmHNew4dG4dHNPiFHKTRerBRNs1drATWprRE50dIGVUkfTYX7jjly3cyr2skHE8n90brPfHQ47M3FxZjw2jC+y7f+8BZfxW780y6uh+G9x0NWSCk1GyW2SzOmlovMQ0uJaQ0CQvJGOXdzx615KjhlqOp1NDqR2tY/hGCIwRyfBLMNYd3LHaYPxjzWtzdu09nR11oWm1bc6Oqoby61X+gj3wyxEF3Z5PVuQcZyMjxI5qN1msdccNqqkGrm0V3s88oh8+pxskYfWAAM4BOCOeDzUtvGjLjV32k1Dbb86iukFIKOTfTiSGoYHFx3MyCMuOeR5YC8lw0HddWT0h1ZeKaeipJRO2hoKYxMkeOQL3Oc4nkTyGOpUlnuI3xHY4cXdFyVH/AHUuaGE9O0Eh/rLFbEzomQvdMWCINJeX42huOec9y4usNH0GsrcykrHSwywvEtPUwnEkEg6OB/q/rwVyJ9J6sulvdZ7pqqnfb3t7OaanouzqZ2HkWlxcWtyO8BTcsiupfJaCbQd1fa30r6I26oETqUtMWBG4ejt5Yznoo5wnbM/hDSNp/wBuMVUI/vu0kx9K7990pV1lghsdiukdlo2wupns81E++It27Rlwxyzz6815tA6MueiqNtum1A2426JjhDT+ZCIsc5+4u3biT1PL1puaPdHfJ5fGdEVMbQBIyvkDx352M6+78y8vGDdLrjQcVKAasVhcMdQO0iwT6uTvpUlfoGts96q7xpO7str612+qoqmDtqeZ+c7gAQWHmenivvsegnU2oHalvtzfd7wGdnC/shFFTMwfRYwE+J557z3kq7m+pNdtPJrfQkOqrzS3G13t1p1DQRDZJGQ4mMk43NyCBkuGenMjBXAk1nrbh9cqGl1hHRXS11cohbcKYbXtJ8QABkDngt54OCpbetHV9RqVupLLezb64U4pZIpoBNDNGCTgjII5nqD3Lx1ehLnqeuoanVl3p6mChlE0VFQU5ijc8dC9znOcfZySWe44vlC+jpG3PPxW3OMk+H7HIp3q2VkOlbzK8gNbQzkn8m5efWukqXWun57RVSOh3kPimaMmN46HHf3gjwJUapuH2p662vtOodXmtt4iMbIYqZrS84w0yO+M4A4O3PPHMqSzUV9vA75N7d/KTfWOXL0wxp48aqeR6QoowD7Ww/3LvaJ0NeNG26S2N1MyqoxDI2nj8wawwyuOe0zvJdg59E+K5dJwx1JQ6hrNQQa2jbca2MRzSG0sIc0BoHo9pgfFCu5u90TDWDJpNJXtlMCZnUE4jAHMu7N2MKseENn1JXaLhltGrIbdT9tI005trJi12eeXFwJyMHorlAIABOT3nxUKp9BXHTVfV1WkbtBQ01ZJ2stvrKcywbz1cwtc1zeXd/cMTG9tLY5o0NWR68s18vetaSpuULXR09MaJkD6iMB25rQJOeA92SAcZVjqNWbSEtPe3agvVx+FLr2XYxObF2UNNH3tjZk8z3uJJKkqmV2RUvH4Oa3TMsg/yRla7tc9M+iRn3BytrIAyTy8VydU6Yt+r7NNabk1xhkw5r2HDo3Do5p8Qo5SaL1YKJtmrtYCa1NaInOjpAyqkj6bC/cccuW7mVe1kg4nk/ujdZ746HHZm4uLMeG0YXzvDGu8oGxkjJbbHEeo4mH9a62h+G9x0NWSCk1GyW2SzOmlovMQ0uJaQ0CQvJGOXdzx615arhnqKq1PFqU60jbcIIjDE/4KZhsZ3csdpg/GPPC1ubt2nssUkAEnoFVOkrpqTipPcbpHf57HaKecwU9PRxt7R3IHLnOB54Lfn7sc7QoYqiCigiq6kVVQyNrZZxGGCRwHN20dMnnhQOk4cXnStyranSF+gpKOtk7SShrKftI2O582kEEYzj2YyThZx0tR+K11Fl46WOmnu9bdHut0jjLVFpe0bZvR9EDlyz710/KG+0an/GEf6Ei9FRwrvMupoNTw6wdHdmRbHyvoGyNJIc07W7wGt2kADn0JySV7NdcO7vriFlHPqhlPQMLJBALe1x7RrSC7dvB55Jx3ZWtzcu012TpvxR7FWHBX90NY/jR36T1OdPW69W6OZt5vjLu5xHZubRtp+zAzkcic55fMou7h1d7XX3uTT18pqWlvj3PqI6mlMjoXO3ZdGQ4fvjyIWZrvFfbxu+TW6/fQfXMUl0l9qll/AIPq2qK3vhfWXDTFLpeg1F5jaIYGRSQuomyume1+/fu3AjJxyC6tt0zqW26f+C49WRuni7NlPU/BrP2GNoxsLN3pZwOZKdta2e6MeT2xo0rdH49I3SQE+oRx/wB5RgA8oKTHLNr5+vkF2dAcPbnoV0kLdSNrLfLI+aSm8xEZdIQBu37yR8Ucl4Bwx1INSnUn2bR/CRi7DtPglmNnht7TC1ubt2ns5dyBj8oe2GpHovoj2BPT9qk/rDlMuKbomcPb6ZiA3zYgZ/fEgN+nC+jXel7ZqWutUZujrVf4nPlt1RGMv9HBcNvLcByOMj8+YzxDsd8boq5VWqdRQ1cFNF+w01LT9g2WYkNY55yS7BOdowM4PcpNWwSvhV8nlj/B/wC0VK1GuGlLJR6CsUUrS1/mjH4IwRu9IfQVJVjLys8Kt4vNdp3UGmdawtIFHUea1Jb1MTsnHzdoP5wX13uxt4hQa1uTAJhDG2325w55MH7I/afB0hxn1Keax0zDrDTlXZZpewFQBtl2bjG4EEOxkZ6eIXy0hpuHSOnaOywy9sKZpDpdu3tHEkl2MnGST3lbmXb9U0rbTeoPs7s+irEX9o+KUz3AdcMpcbA778mMqw9f/aNqD8XVH1ZXK0Rwzo9FXq73OCq7fz92IY+y2ebRlxcWZyd33PPA+KunrLT101NbXW+gvbbXBNHJFUg0gn7ZjhjAy4bcc+nj6lLZvsTw53B/5N7J/JyfWvXA4K/uhrH8aO/SepPoTSNz0dQtt1Rfm3KhhZtghFGITGS4uJ3biXdT1XJdw6u9rr73Jp6+U1LS3x7n1EdTSmR0LnbsujIcP3x5EK7ncfbxu+TW6/fQfXMUj0ewR6SsjGjDW0FOAPybVGL3wwq7hpak0vQah8xtUMDI5YnUTZXTPa/fv3bgW5PPAXWtmm9RWzTZtTNURuqo+zZTVfwc0CGNoA2Fm7DuQ6k96nbWtr7otwAG3T15aOQF0kwP5jFaKg2guHd00PPI1upW1lBNI6aam8wEZe8txnfvJGMDl6lOVM7u7hPCuNX6ovly13RaIsNa21l8Xb1Vb2Ye8NwXbWg8ug+c92DmPcYNL11o0Y6pqtU3a5N84jb2FSWdmSc88BoOR7VNtXcPn3y+Ueo7RdH2m80bdjZuzEjJG8+Tm5HiRnwPTouZqPhtqDW1rFLqHU8LXRvD4WUlHiJpHIucC4FzsHA5gDJ5HK3jZNJYnlrcXWykc45JhYSf5oX21AkNPKISBKWHYT++xyXP03bLlabaKS6XVt0lY7DJm0wg2sAADdoJzjB5+tdRc6qqPJ1axml7oxwLahtwcJGnqB2bMZHt3Ky6ue1xXCiZVy0TK55eKRsrmiVxx6fZ559MZx3KMVGgqu236qvulbs22VFad1XSTw9rT1Ds53EAgtOSeYPeemSvbaNI1LL6NQ364tuVyjiMNOIoeyhpWH42xuSST3uJzjktZWW7IivEX5UdDfyr/wBJq6vFPWdz04202qydky5XmfsIp5RlsIy0Zx0zl7eue/kvpv8Aw1v191FTXt+r2RS0Mr30TPgxp7BpOQ0neN2OQyR3Lp6r4fjWFjoKW4XSRt0oSJIrjDEGHtMczsB5A4BwD3Dmrudto4eqdGXik0hd6mu1teKt0VDM+SPbGyKXEZy0txkA9OveuvwcJdw2spJz6Eo/+a9ees0Xq3UFqqbRftVU7qSSIs3UlGGSSux6Jec9AcEtbjPTIC9GltE37S1hls8GqmSRsj2UjjbmjzZxeXFxG8785PIlLe2tnu4XCr7e+IX4ez9OZfzWzQ/jNo0OGR2Tz7xvK6WmOG9801fqy7M1ayf4RnbPXRfBrW9vguOAd52fGd0HevheeGt/u+pqfUB1gyKpo3P80HwY0iFhJw0+mN2AcZIV3N72ez6uPoB4fvyOlXFj6VLqhjW6NljAG0W4tA9XZLg630Bd9a0EFum1OynpGRx9tGLe1xlmbnMmd4Lc5+L0GF7ZNMakk0z8EHVcfnJeWuq/g1mDBs29ns3YznnuzlZ7ag4HBdlTLwtbHRythqnOqGwyPGWseSdpI7wDgr2UFk4mx11O+t1TapqVsrTNGylAL2ZG4A7ORIyvbw/0NctDweYv1A24W5rXFlN5kIi17nA7t+4k94x6/UpgmWXe6WRBdaaCj1NfYbtZr6606goog3dGQ7LDnG5oOR1cM945YK4jNa600NerdbdZQ0VxoK6UQxXGlG1wcSBzAAHLIyNo78E4Upu2jri7Uz9SWO9+Y1ksDYJoJ6cTQStb0yAWkH1g/nXnm0JcdQ3W33HVd2gqm26TtqeioacxRCTIO5xc5zndBy5fSVZZ7o4XG70Z9JSH4rbo3J8Obf7lLuI8rIdBX5zyADRSt95bgfSQv5r3RVPrmx/B8s7qWaKQTQTtGTG8AjmO8YJ71wZOHmpb5aKi2an1ca2ndEWRRxUrWN34w18hGC/acENyOYBJSWag6fCL5ObJ/JO+scozw8dEOLWtmkjtS4Fo/ih3P87VLdC6Suej6Ftuqb825UMLNlPEKMQmL0iSdwcS7Oe9V/pyxT3fifrGeguMltuFJO10FQ1ge3DiQ5r2Hk5pwOXiAR0Sa7n0dfyiHR/YVSNdgyOuEewd/wC1yZXu4sNmZwhq21H7cIqUSffdpHn6V6WcPLle75R3bV17juTaB2+moqen7KFr8g7ncyXdBy9XXHJf3jb8ml29sH1zEl8Qd7Q7o36LsJhILPg+nAx/JtVf6HzJxv1bJAP8nbA5ryOm/dH9OQ/6V1dOaW1LSaYtrNO6kio6OppIpTDVUomNO57AXGN2ehJJ2kYGVI9E6Io9F0c7Ip5aysq5O1q6yb487+fPHcOZ5c+p5lO02ITwQLo77rSGpGKxtc0yZ5E+lL/Xn519nlElrtKW2Fo3VD7i3swPjEdm8HHvLfoUmvGgpH6hdqXT10daLpK3ZUbohLDUtwOT2ZGDyHMHu8ea+um0DV3K/Ut91Vdm3OoojupKWCHsqendnO4AklxyBzJ7h1wE3N9Rrtp5OMwkHC24CYgygU+8j992rMqT6OY2PSNkY0Ya2gpwB+TauTr7Rlz1rRm3Q39tut8jWiaA0YlMjmu3B27cCOg5epe7SNhvGn6TzS5X5l1giijip2to2wdi1oxzIcd2Rjr4etTt0r7odx4/c/T340Z+iVaCjmvNGQ64s8dC+rfRzQTNqIJ2t3bHgEcxyyME968tp0jdX6lh1DqG50tZU0lO6npoqWAxMZu+M85cSXEcvBO1h7paiIsKIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgyQi/uEwvym3o00Twn+T+1flvrnqWqJcJ/tAtX5b656lq/Ten/Kx+0cMvIiIuqCIiAiIgIiICIiAiIgIiIPHeLYLxbpaI1lbRiTb+zUcxilbgg8nDpnGD6iVG9O8MLZpi4+fUF1vm50hllifWZjncQecjQBu696mCK7qCIiiiIuPbtZadu1a2hoL1Q1VU7OIYpQ5xwMnl7lR2ERFAREQEREBEXmr7nQ2qHt7hW01HDnHaTytjbn2koPSij8XEHSc0zIYtRWx8j3BjWtqGkuJOAApArpBERRRERAREQEREBERAREQEREBERAREQEREBERARcu76psdgljiut1o6KSRu5jZ5A0uHTIyuhS1MNbTRVNNKyaCZgkjkYcte0jIIPgQrofYiIoCL4uljbI2Nz2h787Wk83Y64C+SAiIgIiICIiAi+iurqW20klXWzx09PENz5ZHYa0eJK8tn1JZtQGUWm50td2OO07CQO2ZzjOPHB+ZXQ6KIigIiICIiAiIg4OqNFW3VklHPWS1tNU0Jc6nqKScxSRF2M4P80Lmv4ZW6slgdeLvfL1DA7eymr6oOiLh0Ja1rc+9TBFeqpoAAGAMAIiKKIiICIvLc7rQ2akdWXGrhpKdpAMsrg1oJ6cyg9SLw2i+2u/QvmtVfT1sUbtjnwPDg12M4OF7lQREUBERARFx5NY6diuXwXJeqFtd2gh83Mo37ycBuPHJV0OwiIoCIiAiIgIiICIvj2sfa9lvb2hG7Znnjxx4IPkiIgIiICL+Pe2NjnvcGtaMlxOAAjXNe0OaQ5pGQQeRCD+oiIPPcKMXGhnpDPUU4mYWdrTybJGZ72uHQ+tRK1cKbZZ7t8K0t51CKl8rZZnOrj/lBac4k5ZePEHxKmqKy2IKN6t0HQ6yIbcLjdoqfYGOpqap2QyYduBczBBOcc/UPBSREl0OPpnTEOlqR1JT3C51kR2hgragy9k0DAazl6Ix3BdhERRERQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQZLREX5Pb16aH4UfaBa/y31z1LVEuFH2gWv8ALfXPUtX6f0/5WP2n7PLl5oiIuqCIiAiIgLjXvWWn9OVLKa7XWno5pGdo1khOS3JGeniCuyoLxu+TW6/fQfXMWsZu6Supc+JmkLRNFDWXynjklY2RrWtc/wBFwy0naDtyCDzx1Xsu2tNPWO2wXKvu1NFSVIzDI0l/ajxaG5Lh7AuXpPTFtPDuht0tNHJHWUDH1Bc0EyPewFzie85PLwwPBRXyfKGObS9RcJ/2aZlQ+liL+fZRAB5a3wBc9xOOvLwV1NbTusexajtOpaU1Vor4ayFp2uMZ5tPgQeY94X0X3V9h00+OO7XOCmllGWRHLpHDOMhjQXEZ78KB6Kp47Rxq1ZbaNohpH0rKgxMGG7yInZx7ZHfOuzqvUGnrDrOjqBb6y76lkpfN4KWkaHujiLi7cc8mnrz64z3J0912kFm1rp+/1RpLfc45KkDd2EjXRSEeIa8An5l6L5qWz6bjiku9fDRMmJawyE+kR1VS8VNRXWWGyXWbS9bZqmjr2GGslljcSCHEx+ic89oPPlyKtfWH2pXv8AqPq3JcdaNvDWcR9J0NDT1097phBUhzoiwOe54aSCQ1oJwCCM47l0rFqS0ampXVVnr4ayJp2uMZ5tPgQeY96hXAe0U1LoWnuDYmmprJJS6QjLtrXloaD3N5E48ST3rkyRx6T49UkFvaIKa9Um6ohYMNLiH8wB09KMH3nxV6ZuyJtbqrbjZrAWKweZW+7vorw6SOVrIXlshiJcCcju5fQrJVc8ffk/f+FRf1rOHmLfCRac13p6+GkoKO809VXPiBMTSS4kNy7u9RUNvT6W3ceLTNIYaaCO0vkkecMa0ATZJPRWZav3Lo/wCQZ+iFVurLVT3njvY6SrYJKc28SSRno/aZnAEd4yBkd61jrdSpva+JWkb1cG2+hvlNLVOdtawhzN58GlwAcfYVIKysprfTSVVXPFT08Q3PllcGtaPEk9FWHlAUMEOlqC5wxtirKStjEUzBhzQWuOAfaGn3Ka6wksz9I1h1DMYbbJE3t3NOHHmCAMc8k45BTU7WLt5GcU9HPPK9MDN23tXQyCLOcfHLdv0qTNqoH0wqWTMfAWbxI12WluM5BHUKBUetZ7xZ2w2vh/damzyRdnGJDFEySLGBhpPxSF5eANbPUaMqaaZzy2jr5IYmuOdjNrXbfnc750uPbZtzKDidbxxVuUk+ox9j5omiAOkd2Pa4jzgePx/pVo2i9W6/0YrbXVx1dMXFokj6ZHUKvLR/7wN7/FbfzQq0Ey0R9VZVwW+kmq6qVsUEDDJJI7o1oGST7lS9Hq7S954q3W63240c1tpKdsVuM43Rg+jktGOudx9/sV2qr9D/ACxaz+8j/spj7pXl4vPoKmDR9ZbxCYJ7jG+OSJoAe04IPsVpXC40dppJKyvqoaWmjGXyyvDWt7hzPr5Kt+N/x9KfjRn9SlvEGTT8el6k6mkc227mFzWn0pHBwc1oA6kkdPDPcl7yK+mHijo+d7A29Rta921sskMjIyfv3NDfpUoY9sjGvY4Oa4ZDgcgjxVd1mr63UGnZ4YdAXWS2VNO5rTK6KMbC3kQ0nkMYI92F8uCl1mm4bwy1L3yCjfLG3JydjeYHuzgJce2yVJL9rzTWmaptJdbtDT1DgCIQ10jwD0yGgke9fCXiJpOCjpq2S+0baeq3CJ+44cW43DpyIyOR8VCOAtKy70961VXBs9zq610TpXDJYA1riG+AJf8A7o8F9XEe0U1FxS0XXU8bYnVlWBKGDAc5sjPSI8SHAE9+0eCvTN6TazHaks7LML2+407La5u8VLnYYRnHLPr5YXHh4p6OmkjZ8NRxCX4j54ZImO9j3tDfpXJ4xWO73W12ustNH8IfBta2qlosZ7Zo/i/deGBzw4rmVXEjRuuLdLpzUsNbY5ZwGuZVxhvZuzyLXkENI8XAKTHc2bWk1zXtDmuDmuGQQcghf1fVSxMp6WGGJxdHGxrWuJzkAYBXj1JcX2fT10uMeDJSUks7cjPNrCR9IWWnju2udO2OsNDXXNjaoDc6GKN8r2j1hgJHvXss2orTqGlfU2qvhq4ozteWHmw+DgeYPtCqXhFqaCyWCesm0/qO419fUPlnraW3umbJzwBvHXByT6yV7LfU10nF6lvVp05fqC3XCDsbgaqgfE1z8O9I8sDmIznxz4rdwZ2nEXE7Rs0rIo9QUTnvcGtaCeZPQdF0b5qyx6afCy73KCidMCYxIT6QGM4+cKv9d/8AsRxLsmr2ehRXH/Ia893gHH3YP5NSLXX/AG/erJpFnpRVMvn9eB082iIIafU5+0e5TpnZdpPRXu23G1tu1LWwSUDmucKjdhmGkgnJ6AEH5lw28UNHucB8NRhhO0SuikERP8oW7fpUQ4+3OZlPYbI3tzTXGpJnZA0l8jWFgDQO85fnHiAuzU6utVVZn2V+iNWCgfD2HYi0O2tZjAA58sdyTHttNppX3egtdufcqyqihomNDnTk5aASADkeOR865DOImk5KCevbfaM00Dmskk3Hk52cADGSTg8h4KPcEBeqbSkttvNFXUrqSoc2nFVA6MmIgHA3DmA7d864nCez0tZrrWlxqI2yyUtwkZAHDIYXSSbnAeOGgZ8M+KdM7m0wpuLeiKpj3x3+ANYQ0mSORnM5/fNGehXZseqrJqUzCz3GCt7Db2vZE+huzjPtwfmXkrNDWarkvMvm/ZyXmnFPUlvQgAgOA/fc859QUU4K3eantNy0vc3hlZYah8Z3H/wiTzye4ODufgWpqa3FSqi4g6WuNfHb6S90s1VI/YyJpOXO8OikKhfDtrrxNd9XzNObtUbKXd1bSxZazl3ZO4n3KaKWapHlul2oLLRPrblVw0lNH8aSV2B7PWfUo9HxT0bJJHH8NxxdocMfNDJGx3se5obj15UP1W77JeNljsFYBLbqGE1BgcMtc/Y5+SO/owewH1qxNV6apNWWGqs9XhrJ2YZJtDjE8dHAeIKupNbHA4wNhm4b3edojk/Y4iyQAHkZWdCuxoRzWaFsDnODWtttOSScADs2rhcUKMW7hLcKIPLxT00EIcRjdtewZx7l1tJPp2cObQ6skbFTC0wmV7jgNZ2QySe7kn/8nu+uTijo+OV8YvUcvZnD5IYpJI2+17Wlv0qQ2+5Ud2pI6ygqoaqnkGWyxPDmn3hV7pbWlLDamW/Ruj7vcLTSkxMqPQiZKe8guI3Enr3rxcH6yZurdX240clvg7dtQ2ic4EU7yXbgMcvDp4BLim3aukuhrzry21dRe8Xy3SGmipWS4a5+4ja4Y6gk9CPXlSW96wsOm5o4LvdKejklbvY2QnLhnGVB+KPyg8P/AMNf+nEu7xj+Ta9feRfWsV1vQ9ty4maQtDoG1l8p2OqI2yxhrXPJY4ZaTtBwCCDzwvbctZ6etFqhu1bdqaOiqP2mUO39r96G5J9wXH4f6ctzeHdspJaWKWOuoo5Kje0Ey72A8z34BAHgAB3KK+T9bY32a4Vk57aSnqnUkBfz7FgAe4N8Nxdk464HgpqdzdWRYdTWfVFM6ps9whrI2EB+wkOYT0y04I94XTVVaYp47Tx11BRUbRDTVFAJ3RMGG7z2Rzj2ucf5xVqqZTSx/HvbExz3uaxjQS5zjgAeJUXdxQ0exzgb1GWNO0ytikdED/KBu36VGPKAu9TRaXo7dTvewXGpEcuwZLmNGdvvO324XRpdXWqkssdlj0RqzzBkPYdibQ4tczGCDz557/HKsx7bNp1HJT11O2SN8VRBK0Oa5pDmvB6EHoQqz4UtazXnEBrWhrRWsAAGAPTmX3cD47vQW262u4W+40dJT1O+iFbTviJjfuyBuHPG0E46F3rX1cK/t+4g/hzP05lda3E+iwL1qG1adpm1N2roaSN7trTIebz4NA5k+xeK06605e60UNFc2OqnDc2GWN8T3D1B4BPuVXy6gZU8arjWXC2XO6xWiIw0lPQ0pnMLhtG8tHdkvOfEjwC9XE67zautNK61aU1VDdqKoZNTVElre0sx1G4ZPgfaAnQbWdfNV2TTRhF4uUFEZ93Z9qT6eMZx7Mj51zrhxL0ha4aeWrvlM1tSwSRbA55c0nAdhoJA5HmV5NZ1M9ZwquFTVRPhqJrWJJY3tLXMeWAkEHmCDnkvLwjsVDFw8oDJTRTPronPqHSNDu1BJAac9QGgDHqU1NbqpFU6y09R2WO9zXalbbpeUc4dkPPgAOZPI8gM8ivnp/Vtj1VE+WzXKGsEeN7W5a5memWkAj5lW3A+0QR3HUQeDLHbq10FIx5yIck7y0HoSGMBP8VeqGmjtPH7s6NogjrrcZJmMGGudg88e1gPtVuM7xNrMuVzorPRyVtwqoaWmjGXSyu2gf8A39S4lHxH0rXVUVNDd42yzHbF20T4myH+K57QD7iq+4n3VtXxR0/aKykrK+20cYqn0VLCZXzSemfiD4wwxvsG71rq671HBq3Stdaho/VZnfHup3SWl4DJRzac93h7CUmPg2sG8362aepBV3Wsio6dzxGJJOhcQSB9BXKn4kaRpra25SX2kFK97o2vblxc4AEgNAycZHQd4X18PKi51OhLebzT1MFfHC6GVlRG5j/RcWtJDufNoac96hnk8WilGmqy6Pia+pkqnQNe4Z2RhrTgeGS4k+PLwU6Zq7XayLDqaz6npnVFnuENZGw4fsOHMPdlp5j3hV5xQ17FbdTadoqC+Op/N64C5xRSFobHujOH+Ixu+lf3TVNHaOO1/o6NohpqigEzomDDd57I5x7S4/zivt4w/bNoP8aD6yJWSTJLeyc2TV9h1JLLDaLnT1kkTQ57YyctHTK66IsNKk1DxHo6fipZ2Q6g7OzQwyR1zGyERCUCQYcO852/QrHs+oLJqqCV9srKe4RRODZNoyGnqM5CgeqPl20p+BSfozK0FrLWokU5wk1JZ9L2O/1V3r4aKF11e1pfnLjtHJrRzPuCs3T+rbHqqJ8lmuUFYI8b2tyHsz0y0gEfMq34E2mmkm1BdJY2yTsrnQxFwz2Y6u2+BPo5+9C9EVNHaOP7Y6JjYI6+3GSZkYw1xweZHtYD7VrKS2pFnXC40dqo5KyvqYqamiGXyyuDWt964NLxK0nWVEUEd4ja+ZwbGZYpI2PJ6Yc5oafcVAuLl0854habsdXTVdbbYWtrZaOmiMj53bnDG0fG5M+YuXX1nqal1RpevtB0dqwvlhd5vvtLwI5QPQOe7Bx07sqTHwbWYiifC2e6y6It0d6pqqnracOgc2pidG8ta4hpIcM/Fxz78KWEhoJPQc1izV0rhX/XOnNLzsp7vdYaad4BbEGue/B6Ha0EhV3xDu9pvuodA3C0VNPVQvuwDpIuu4SQ8nd4PPofFfZwMiZf6u/6srmtmuFRV9m2R4BMTcbiG+HxgPY0L+cV7RTUnEDRNxgjbHJVXBjJtowHlssW1x8ThxGfADwXSSTLSXwt172xMc97msY0Euc44AHiVF3cUNHsc4G9RljTtMrYpHRA/wAoG7fpUY8oC71NFpejt1O97BcakRy7BkuY0Z2+87fbhdGl1daqSyx2WPRGrPMGQ9h2JtDi1zMYIPPnnv8AHKzMe212nkE8VVCyeCVksUjQ5j2ODmuB6EEdQo9cOI2lbZWy0VRdmOqITiVkMUk3ZnwcWNIB9qivBaC80lmvNorKK5UFPDOXUDqynfG4Mfu6bhzwQCQOhd61wtGaum4T0Uth1VYK+naKhzxcYI98cu49SeWfaCTjAwMK9HeptbVk1FadSUxqbRcKetiacOMTslh8HDqD7V5r5rOwacnjp7ncooKiQZZA1rpJCPHY0E/QuXox2ljHeL/purFRDXyCeojZgCJ7W8wGYBaTzJB6kqLcB2OvMV91VXBs1xrK0xOmcMlrQ1ri0eA9Mcv4o8FOmd6u06smudOaiqnUltusM1S3JMDg6OTl1w14BPzL+fZ3pn4VNp+GaXz8S9h2GTu7TONvTrlfy4aPpK3V1r1O14hqqBksbw1g/Z2uaWgE923Jx7VBOM1Ay6aw0PQyOcI6iqkieWnB2l8Qdg+zKSS0TA8U9G/CTLa2+wSVUkgia2ON72lxOAN4aW9fWuZRS6HvHEOG80d77e+iJ1MymZL6Bw12Ttx1Dc9+OXTKkt00jZrvS0VLPRRsioZmTU4iAZ2TmHljHQepQfUny9aV/AJf0Z0mvYTO76601Ya11Dc7xTUtS0BxjkJyAencvNdOJWkrLWuoq69wR1DDte1rXvDD4OLQQD6iVF/KF+0WD8Pj/Qepza9O26i0/FZzSQyUphDJWPaCJSR6TnfviTkknqU1NbHpF4t5tRuzayF1AIjOahrss2AZLsjuwFVmk+J1vZrfUr7pqMfBTnN8x7WRxjxk52DuX38EJ5LddNV6ZEjn0turT5uHc9vpvY7n69jT869HDz5VNc/yjP0irqTcTaRarvukLxpYQXa9RwWy7Mc2KeN5aX7XDJacHocdQuvpCG1U2mrfBZKk1Vuii2QTF24vAJBJOB357gvo1/8AaNqD8XVH1ZUb0FcX2fgtBcYwDJSUFTO3Izza6Qj8ymuy+6SXjXem7DWeZV90jZVAbjBGx8r2j1tYCR717LHqS0alp3VFor4KyNh2v7M82HwIPMe8KE8CrfENIvvUn7LX3KplkqJ383uw7GCfDIJ9riudqhzdLcaLBWUAEIvMYgq42DAlJdt3EeOdpz/F9qdM3pNp5U6701R3Q2qovFNHXCQRGAk7txxgdPWF5JuJ+jYLibdJqCkbUNdsPxtgOcYL8bR86iHHen88k0rTb3R9tcOz3tOC3O0ZB7ipJxH0/bBw3ulHHRQRw0dKZIGtYB2RYMgt8OmE1Oxupk1zXtDmkOaRkEHkQv6otwtqJarh9Y5Jnue/zfZknnhpLR9AClKzZq6VH6XiBpatrTQwXyjfUDflm7GNoJdknkMAE+5fTbuJmkLrcG26jvtLJUudsa0hzQ8+DXOABPsKhOu7XBeeNml6KpbvgfRlz2Ho8NMzi0+IOMEd4JC9vHy20w0XDXMhZHU0dVH2MrBhzAcggEd3Q+4LfTO36ptZ6jVVxJ0nR1EtPJeI3PhJbIYopJWRnv3Oa0tHvK4vFO/1ds4YSVUErmVFZHDCZB1AeBu9mRke9c/Q+qqHTukrdbqfSWqngQNdLJFanOZM9wBc8HPpAk8j4YUmPba7WA2/2p9nN5ZXwPtwYZDUtdlgaOpyFzbdxB0rd62KhoL3SVFTMcRxMJy44z4epQvhPHcKDV2oaaOzXW22KrJq6VlZSPhax+4DaMjAOHdM9GjwX8tv/sJxkqqA+hbdSx9tF+9bPknH9LeMfx2q9M7xNpzd9c6bsNaaK53impKkNDjHITkA9D0XurL9a7faxdauuggoXMa9s8jsNcHDIx457go1Wf8AtNxIpqP41FpyHzqYdxqpRiMH71mXD2qGcQbu2r4uWe3V1FW3G3W2LzjzKkgMr5JC1zt2wfGHJmfUD4lSY7XaxKHiJpa41cVJBdmCeY4ibNE+ISH+KXtAPuXTveoLXpymZVXatio4Xv7Nr5OhdgnHzA/Mq64hX+LWOlqu2M0fqs1RAfTPktTwI5AeRz3csj2FSvStVcqzh1TS3eGohrxRvjmZURlkmW7m5cDzyQAfXnKXH3NvuqeI+kqS3R3Ga+0opZXOZG5uXF5HXDQMnGR3Load1PaNV0Tq6zVgq6dkhic8MczDgAcYcAehHzqvvJ+s1I3SctzfE2SqnqHxCR4yWRtx6I8BkuJ8cqwrFpy3acZWR22HsY6ypfVyMB9EPcADtHcOQ5JlJOxHTREWFEREBERAREQEREBERAREQEREBERAREQEREGTcJhf1F+R29rQvCn7QbX+W+uepYonwq+0G1/lvrnqWL9R6f8AKx+0/Z48vNERF2QREQEREBV7xnqaqs0vU2Ghs13rqmrbHIySlpHSxN2ytJDnN6HDTy9isJFZdXaVDNP6odRaLpJJtP6iElFFDSPp/MHds9wYAXNZ1Lc96jfBKeusFhqbPcrBfKacSy1YfJRPbG5u1g2hxxlxwcBWuivV20aU7YrtWwcWLvqKXS+pmUFxpo6aIutrw5rgIgS7uA9A88r2XukuOjeK82rZbXW3G0V9MIXyUsZldTHa1vNo5/cDn4OPfyVrIr1GlM8V7tcNdWKgZYLBeaqjgrGyyTGjeHOcGuADWY3EAF2XYwDtHerBut2F70HeaxtDX0QdRVLexrYDFKMRu5lp7lJVHtcG9TWSoobNaGXF9bDLTyF1U2HsQ5hAdzB3denLom96gr7hPqufTGh6Vt0tlfNb5XSyUtVRwGZrRvcHRvDebXbgSD0Id6iuppmzXPVvEaTW9xttTbaCkh7C3w1TdksnIjc5vcMOefeMZxldThTbtRadscFgvFljpYaVkjmVbatknaudIXbdgHLk488np61Olcsu90kgoVxhsNdqHQ1VS26B9RUxyRzNiYMueAeYA7zgk49SmqLEurtUFs2s7hdq6xWyz2upbC2L/tSWtpJYxTBrBhjScAuJyO8KLXO8VsvFig1MzS2p3UFJRupn4tsm8u/ZBkDoR6Q55VxotTLXsaVZxvmrb1YYbJbrFequoMsVV2kNE98Qbhw2lwzhwyOS9eurfXcROHL47ZbrjSVVPMyRtLWwmCSXYMEAHuw7I8S1WQidWtGkAsfEYOtNLbmacvbb1HA2LzF1G5jQ8DGS84a1mR1OMDuXG4IPuNjpauy3Wx3mmqKmrkqBPLRvZABsaObzjBJace5WwidXbRpV9xZPpPi9U6krqKtfaq6gEAqaeB8wjeNgw4NBI+J4d/tUx0beLvfaGqrrpQChifVPFFE6NzJDTj4rpA4nDjz8F30Ut2afTXVQoaOeqMM84hjdJ2UDN8j8DOGt7ye4KpNI3OtouJN8vE+mdSx0l2MccLnW542HLRl+eTR61cKJLo0qXi9VV13uVpo6DT1+qfguubPLNFQvfE9uAfQcPjL3cULTceIOhqWrtNuro56ep7fzGrhMUz2jc0+ge/nkeI9qsxFZlrRpAv1RzeLTLR2/T16F5kgczzSWkcxsLy3GXPPINB958M8lzeCD6y2WF2n7lY7xRziSWcy1NG6OEtO0bdzsel6lZ6KdU1o0qXSYrOEVyulouFruFTZKqfzijraSEzBmeW14bzBwGj2jvBXN1dda6+8R9FV0lvqKGgdVhlLHVN2TPw9hfI5nVoOQADz9EnvU1grNd2S7XNklkbfbfPVPlpJIq2OOSGM9GEPxkD6OfVeej0zfdTa1pNTaipIrZTWyMso6Bk4me556ve5vLv6DwHv3vvuo7GsrvfbJV2irtluqbhb2yvFwhpow+TYW4aWjrkHJ5dcYUV4h3Kh15p+S0WixXK43V7miF8lBJCKU7gSXSSNAbyyOvPKtFFiXS6c3TNtms+nLXbqmQST0tLFDI4HILmtAOPVkL119FDcqGooqgEw1EToZADzLXAg/QV96KKrDRNTW8MKap07f6CvkoY53S0dxpaZ80T2OPRwYCWuzzwR3n1EyK2XW/aj1LFVUsNXbNO0sTg8VVOGSV0p6Ya4b2sb1zyz61LUVuW+6aRriNpn7LNH3C3MZuqNnbU/j2rebQPbzb/OXC4R2q8Opai/ajgnhuU8cVFFHPGWPZBE0AEg8wXOy4+PXvVhInV20aQjiroys1Va6OqtO34Vtc3nFM15AEnTLcnofRaR7PWvvp+JED6QNmsN/jugbzt4oJC4u9T8bdufuiRyUwRN9tU0jNjrL9adMzXLUraitrnPdP5nRQte+BhIDYmhoG8jvPPv5nCg3DW5Vtk1HqF9bpnUkcd6uIkgkNueGxtc9/OQn4oG8Z696t9E6vJoVMcTbDdLfr6lqLE7sjqindbaggdD6Ic71ejtP80qztWVF+pbW2bTtGysrWTxl0D3tYJI8+mNziADjvXGs9svV81azUV/tjbZFQU7oKGjM7JnB7/2yUlvIZADQPBXG67lSq3UEFroKagpWbIKaJsUbfBrRgfmXoRFhVd6601c6HV9q1zZKJ9fNRNMNXRsPpyREEZYO84c7l6m+tey665rbzbnUWlLbdReJ8Rh9VROijoiTzdI5428hnkN2VOEWur6ppXnFOev+wuXTrLdeLvcKqnjBqaWiL43Oa9pcXbBhpO0nAHelop6vVPC+XTbbdc7ZWwW2KkzXUzoWySBmPRJ6ty3BPrVhonV20aVboHWJ0ppyk07erBe6a40e6NscVE6QVGXEgsI5Hr7O/K8OhKm82riHfqy76avUIvE7GxvjpHPiiy7lvkHo4AIyRkcirgRXq89jSoeIlwrrlrfTlVSab1FNBY6x7qiRlve5sg3s5xkcnA7Dz5dy7HE+81F50NLb6LT+oJqi5wtfGxtA8mHbI0kSY5tOAeSsZE6vBpCdJalfbtDUQqNP6hbNbaanpZIPMHdrI4MDSWN6uaCOqjvBSeusdDXWm42C+Uss9XLVsllonsi27GjBccekdpwFbCKdXk0py3Xiti4sV2pn6W1O2gqqNtMzNtk3h37GMkdAPRPPKuNES3ZEO4p6Ll1tpo01G5ra+lkFRTbjgOcBgtJ7sgn3gL42/iM1tFHFdrJfKe7tZiSkjt8knaPHImNzRtLSehJHVTNE321TSLWGv1BRWSvvOo4amaWWV00FtpYWyS00OcNjG0Avd3nmfzqFcOa+ututtSVNXpvUUMF8rGOp5JLe9rYxvkOZCeTR6Y8e9W8idXk0ra7WO46O4iSaxt9vqLjbbhD2FfDSt3zQu9H02s6uHoNPL+N6l0rtrC46gpW0GjaS4MrZ3ta6vqaJ0UNG3I3OPaNAc7GRtAP0KbonV9TSGcTKuog0hU2mG3Xa61VfTPhbJSUplAcAOcm34uc+HcfBePh5fZrVoSKnq7BqCKe1QsbJE6hcHzFzj+1A8347/BT9E320aVNwjqK62Xu9U9dp++0outc+ohmmoXsiY30nem4/FPd7SvJV3itdxXp9TN0tqg0ENGaZ2LbJvLvSGQOmOY55VyIr1d9ppXmvtNXL7I7Lrex0j6uqtw2VNGDiSWHnnaD90A94x15jwXQreILq2glgsFnvM93e0sjgmoZIhA8jkZHPAaAOvU5UzRTq+q6R59fcNNaXpn3dtfe68NEc7qClD3ueckkMaB6I6Zx4KGcD5a6yWOayXKxXqkqO2lqhLNRPZEW7WjbuOPS5HkrUROrto0pu33etj4sVupn6W1O2gqaNtMzNtk3h3oDJHQD0Tzyu/wAXrTcKibTV5oqKorY7TXtnnjp2F8gZuaSQ0cz8T6VYqK9XfZpFbFqyu1JqSaOhoZGWCGlBNXU00kUktQXfFZuxlob19Hr7QpUiLNFa68oqu2cR9N6rNFVVNtpYnwVL6eJ0phyHgOLWgnHp9fUuxbdbXKq+GLpLZK99lp3xR0DYaKTzupzye7YTktB6chyz4KZIr1djSp+DE1daZblbbhYb5SPrqySpjmnonsia3b0c44weS8dbd613Fim1M3S2p3UEFGaZ2LbJvLvTGQOhHpDnlXIivV32aV9xE0vcqm72TWNjpnVNda3DtaQna6aHOSG5+6GXDH8b1YPvqeIgqaGSOz2S91F3c0tZSS0MkXZPI5do9wDGgHqcqZIpv6mnO07TXSkstJFe60VtxDMzzNY1oLic4AaAMDp054yuiiKKqbTkVZwjv12oqy119VYK+YT0tXRwmbsTzG14HMciB/N5Zzy5+vau+6j1Lpi+U2m7ybRbqsSNaKR7p34exz3lgGWtIaA3OM4KulFrr77Z0gevdNycS9FRSUVPU0VdFJ5xTQ1rDDIHAlpa8H4uRnHuXpt/EZraKOK7WS+U93azElJHb5JO0eORMbmjaWk9CSOqmaKb9l0jWmzqiWz3CtvLgytqXySUdEAz/JGYOxhcANzvEkn865Fl18+KzRUmrrTdqe6Nb2czPg6SSOoPiwsaWkEd3LvU8RNituFml6u33zUV6fa5LTbLlIPNKKVoa7YC45cz7jryHrPcvLpWmrOEtyudsrLdXVWn6ufzilrqSF03YcsFsrWguHINGcd3fnlaaK9X1NIjQXm96l1NTTW+Krt+naWNxnfVUwjfXSH4oa143Na3ru5Z5hRDiLXV1w1xpyqpNOahngslW91RJHb3ubINzDmMjk4eifBW6iky1TTxWe6C8W+KtFHW0Ykz+w1kJilbgkc2npnGR6lVV9u9bU8VbNqOLS+p3UNup5KeUi2v3OcRKAWjoR6Y55VxIkuhVvHyfzrh5RziOWLtayF+yVu17cxvOHDuI7wuuziDU2O2x0N009eZrzDGIhHS0rpIqpwHJ0cg5bT158xnGOS8PF2x6o1fQiyWqxxSUsczKgVjqxjS4hrgW9mQCPjdc9ym9gq7pW0HaXe1NtdQHlogbUicFoAw7cAOvPl6lrt0xPdE+EukLhYKO5Xa9RiK6Xmft5Ygf2tuSQD4HLnE+7wXIoJZdC8SNS191oLgaC6NbJTVFPTPma9w57PRBweZHPwVqos9XfuuldXnUN9reHU7Ltp64Oud3pqmKKnt9G+TsAQQztRklpIIPz8uS+XC/fWaIj0tdLNeKJ8VNJFO6rpXQxva9zshjj1OHeCsNE6u2jSrtFVVdwup6nTt+ttfLQsndLR3Gkp3TRvY77lwYCWuyOh8fAAn7bfZrlrniFTarr7bU2202uLs6OKqbsmnfkneWdWjLs8/BvrVmIr1e5pUvFqprrpe7JT0On79Ui01zZ5poaF743t9E+g4fG6H3qRa5v0tw0LUR01hv0s11ppoY4G0LjJC7GB2rRzYD3KcIp1eDSD8I6yoZpSks9XabrQVFBFiR1ZSuiY8lzj6BPxsd6nCIpbu7FPX661s/Fe0ahi0xqZ9DbaeSnlLba8uc7EoBb3EemOeV0uNFVWXnTLLNb7Fe6qoqOyqg+Gie+NgyctcRnDxjp6wrPRa6vFNIRV2xvEXh5Pan0VwtkzWNijFfTmFwlY1pDsHmWE8s+1ebSusJtO2SksmpbRdqW4UMYpmuho5J46kMGGljmAgkgDPrVgIpv2NI1pWp1DdK+4XS6slobbKWsoLdNGwSsaBzkkIGQXH7knlz9S43GPTVZedP09ytMMsl2tNQ2opxC0ukIyNwaB1PJrv5qnyJMtXZpFuHNprKCwur7pGY7rdpn19W1zSCxz/AIrMHmNrQ0Y7ua4uudNXKi1hadc2WjfXy0TTDWUkZ/ZJIiCNzB3uw53L1N9asNE6u+zSF3HX0twt81Npq03ee7ytMcbJqF8LKZ5+6kc8BoA64yc9F0LpXV2n9JRtuMVxvde+LsJX0FLvc6RzDl2xoGGZGM48FJETcFXcFayss9lg07cLBfaSodNLL281C9kDRjIy84weWPbhWiiJld3ZBERZUREQEREBERAREQEREBERAREQEREBERAREQZOwmF8kX4/b36aD4VfaFa/y31z1LFE+Ff2hWv8t9c9SxfqvT/lYfafs8WfzUREXZkREQEREBEVfcX6q82Gwy361X2so3Q9nF5sxkZjcS/BcctJzg+PcrJu6SrBReOyzyVNmoJ5nF8ktPG97j3ktBJXsRRERQEREBFH9cQVxsFXW0F3qrbLRU8tQOwaw9qWsJAduaeXLuwvFwqvFff9CW643OodU1cpl3yuABdiV4HQY6AK67bRLURFFEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREGUEXywmF+NfS00Fwr+0K1/lvrnqVqKcLPtDtf5b656la/Wem/Kw+0/Z8/P5qIiLsyIiICIiAq/46/J1Wfy0P6YVgKv+OvydVn8tD+mFrD5ol8PhZtIXnUWm6CurNVXi21EtLG6np7fII4adu0bQ4YzIcYJyRzJxhfLhbq66XOou2mr/IJrpZ5TH24GO2ZktyfWCOveCO/JUl0VdaW6aQtVZBKwx+aRtfz+I5rQHNPgQQQoDwqYbxxD1fqOm9KgfK6nilHxZCXg5HjyaD/OHiteZdokM+nbpW3a5VmotVV9voTOW0FNR1Yp2iLA9JxABJ59PV35XgsepKqx8QodKPvTr5bbhTOnpZ5ZGvlgeA4ljnt+MMMPXnzHrXA4a2ig19fNQ3PVcQuFyp6nsmUtQSW07MnkGdMZGP5vrK+yuttms/HTTlDZqSlpGx0z3TR07A0B5ZKRnHftx7iFde1Em4maxuFoqrTpyxvZFdbxMIm1D27hTsLg3cB45PzA+pfK66AusFnmmtmr9SPu0UZfG6Wr3RyvAztMeMAE8uXTPeuFxThNo4haR1LU+jbo5W00sp+LEd5OT4cnE/zSrNud1pbTa6i51UobS08Rme8Ec2gZ5eJPd4qeJNCOunudVwtqZryx7Li+0zGoa9mxwf2bs5b3KJ6Hv9JZODlrjlnqm1dYZ4KSGiI85lkMz8CPIPP1kEBTW6XaO+8PLjc4qeop46q2TysjqGhsgaY3YyASOY59e9VXpLhp9kXDKjvNvqqll/ie+aikMpDYuzlfiNo6NBOXZ/fHwVmtd/qLH0dpW/0UdPX3/Ut1qKvJe6i7VjoWtI5McduXEZ5kEDPd4x20XSfXetL/AG+46iuFqZbag09Jb6Ko83dK0OLS8kek74oPI8sqTcONbt1lZ3Cqb2F2oj2NdTkbS145bsdwOD7CCO5cys0horijJWV/ms0NbTVL6Saohd2cu9nLJHMHuwSM4U97sdHTlk1JYdVVME12rbnp6Sk3wvrJGPkin3gbC74x9HJz05+IUvVT6OmvWkeJT9GS3me8Wx9KZ2Gc7n0/LIGe7pjHQ7gcBWws5eVisOM9XdtN0VJebXfbnTPqKyOmdTNe3sWt2OJIG3OSWjv8VM9aUk9Rp+rmprnXW+WkikqGvpHtaXlrCQ12Wn0c+GDy6qG+UJG86MopmtLmw3GJ7vUNkg/OR86lmsr1RU+h7ncBPG+GaikEDmnIlc9hDA3xySFr2iOVwur7hqfh1BNcLhVOq6jt4zVNcBK303AEEgjIHTl3KKWSo1RXcQ75pODUlw8xpmBzqqcsfNGwbchnohocS7GcchnllSXgd8m9u/lJvrHLgaUudPR8c9TUs8jY3VcYZEXctzwGHaPXjJ9yvvT6PnrE37hXLQ36iv8AdbvanziGrpLjL2xAPPLXcsdDjwOOoOFatPUR1VPFURO3RysD2HxBGQq14+1bH6Xo7PFiSur62NsMDeb3AZ5ge0tHvU3hqaPSOmKV11q46eChpoopJnnlkNDffkrN7yUnl10X00dZT3Cliq6SZk9PM0PjkYctc09CF9yw0IiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiDKaL+4TC/F7fU00Bws+0O2flvrXqVqKcLPtDtn5b616la/Xem/Jw+0/Z83k+aiIi7MiIiAiIgKPai0BpvVdU2qvNvdVStjEYPnErBtBJAw1wHUnnhSFFZdeERO4cLtL3CQudRzwNeA2WOnqZI2TADA3tBwTgdep7ypDarRQWOhioLbSxUtLEMNjjGAPX6z6zzXrRN0Ra78NdOXi5Pujqeejr5Pj1FFO+F7/AG7Tg+3GV9U/CbRtT2Jms5c+FpaJBUyte7JJJc4OBcTnqclS5FeqmniqLLb6u1/BVTSRz0PZiLsZRvG0DA688jHXquDT8MNNQdnGaernpYnB0VHPWSyU8ZHhG5xB9+VK0U3RydQaVtGqaaKmu9K6ohicXMa2Z8eDjH3Dhnl4rw2rhzpiyQVcFvtz4IqyF1PM3zqZwdG7qBl5x7RgqSIm6IjRcJ9G26tirqW0vjqYpGytf53OfSByCQX4PMd69FVw60/PWzV1PDVW6rnJMs1vqpKcyEnJyGkA8ye5SZFeqmnIsWk7Npt0sluowyeb9tqJHukmk++e4lx9mcLroiivJdbTRXy3z26407Kilnbtkjd0Pf7iDgg9yjNn4S6RssskkFvfK57HRjt5nP7Nrhh23nyJB69fWpiiS2JpHLLorS+iXT3G3Urbe1sLmyyyVUjmNjyHEne4tA9EHKrWyS6Xv3E/VcV0rLbPQ1oiFO91S1olkG3HZvBHpZ/enKuqaGKoifDNGyWKRpa9j2gtcD1BB6hc+PS9hikbJHZLYx7CHNc2lYC0joQcLUy+pY5tm4dadsdxFzhpZaiuaMMqKud8z2DwbuJx7evrXU1Dp63aotUtrukJmppcEgOLSCDkEEdCuiizu+R5bVa6SyW6nt1BCIaWnYGRsBJwPaeZXqRFFEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERBlVF/UX4nb62l/8LftEtn5X616lSivC37RLZ+V+tepUv2HpvycPtP2fL5PmoiIuzIiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiDKyL5YTC/EPsaX7wu+0S2flfrXqVKK8L/tFtn5X616lS/Yel/Jw+0/Z8rk+e/cREXdgREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERBllF/cJhfhn29L84X/aLbPyv1r1KVFuF/2jWz8r9a9SlfsvS/k4fafs+Py/PfuIiLuwIiICIiAvFdb1a7LC2S6XKioGSEtY+qnbEHHHQFxGSvauXqDTVn1LTMhvFBDWxxEvY2UHDXYxlVnLev5fKKcH7J8CWmvi+yii1F2k4d21LUdqIvRHok5OD3qXVOpLJR1clHU3i3QVUTDJJBJUsbIxgGS4tJyBjnnwVWeTL9rl4/DG/oBcnUNhoNS+UQLbc29pSSQse+LcR2u2DcGnHdkA+5XXd4OPnuPBhcJ5ul02XUVn1HC+a0XKlrmRna8wSB2w+sdy8V017pay1TqS4X+309Qw4fE6YFzD6wOnvVW6bttPo/ygJrPZGmC31VKTJAHEtYDFvxz/jAEeG7C8DbhHrPU97dpHh5a7yBMTU1tzk3by4kbgHOAYDg4DefLKaW+ry6danVuz3vj6aXhBf7TU2s3aG50b7eAXGqEzeyaB1y7OB71AaLjLST8Ra2wzVtljscMW+K4+cgCR2xhxvLtp5ucOXgo35P9LHc6PV9iuNNG+iE8W+l3F0YLu0DgOfT0GjPfgLwWnRun5+O92sUlqp3WyGm3x0pB2NPZRnI95PzppjL1HLnhx54dt3X7/2XzSXCjuFG2to6unqaV4JbPDIHxuAOCQ4cu4/MuVQ660vc68UFFqC2VFUTtbFHUNJefBvP0j7FAuOeNKcM6e1WSIUVFNVtpnsi5ARkPeW+9wGfeO9QG6aWuN10xR0dp4W1dvq4hG9lzjq975OXMkbRnd168u5JHTm9Xnhl0Sbsnfz/AG7fu0Xcb1a7P2QuVyoqHtjti85nbH2h8G7iMnmOnivLQ6tsFzuktqorxQ1FdFnfBHKHOGOvLvx346Km+NgrqzTWhW3NssFdKNtSHfHbIWRh3vzlfPVenLXo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mScBuAOZVpIr1U0jGrLDqm41tNWaa1S2zmJhjlpp6NtRDNk53HJBa4eIXj0loCrtGpK3VV/vhvV7q6ZtGJWUwp4oIA7dsYwE9SASSVM0U2CIiiiIiAuBrnRtDrzT01mrpJYA5zZYaiE4kglacte31g/QSu+iopW5aO1l9nulI9X19Vq3T9PNvhfR0rIBBVNHoSVLBnLQAfSz19uHWAdDZ4mDW/wh0tXwZ5n2P/5m/fv3e7G33qVIrtNK7qODtO/i3S8Q6e6GDsmky0Hm+RLIYnRF4fuG3ILcjaclvXny7VHoXzTiTX61+EN/nlvZQeZ9jjZtc12/fu5/F6be/qpUim6aFWsnCm/Wmtuv2H61lsNtu0zqiejdQtqOwkf8d8Li4FmfDu9wVlIkuhxNGaRt+htOUlitvaOgpwSZJDl8r3HLnuPiST+buXbREUREUBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREGXcJhf1F+Cff0vnhj9o9t/K/WvUoUX4Y/aPbfyv1r1KF+29J+Rh9p+z4nL8+X3oiIu7mIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgy/hML+ovwD9Fpe/DL7R7b+V+tepQoxwy+0i2/lfrXqTr9v6T8jD7T9nweb8zL70REXocxERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREGYUX9Rfz/b9Jpe3DP7SLb+V+tepOoxw0+0m2/lfrXqTr9x6T8jD7T9n5/m/My+9ERF6HMREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERBmNERfz1+mXrw0+0m2/lfrXqToi/dej/Iw+0/Z+d5/zMvvRERehzEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQf/Z";
var SHARE_URL = "https://ipatent.qnfo.org/?utm_source=share&utm_medium=social&utm_campaign=ipatent";
var SHARE_TEXT = "iPatent: free, private US provisional patent drafting with a claim-support map that flags every claim the description never backs up";
// SUBSCRIBE-1 (3.8.0): QNFO's owned audience is one confirmed subscriber; iPatent visitors had no way to join it. The form
// posts here; the worker forwards to qnfo-subscribers (double opt-in, its own rate limit and honeypot) with source
// "ipatent", the same path qnfo.org uses. LLMS-1: /llms.txt describes the tool for AI answer engines.
var SUBSCRIBERS_ENDPOINT = "https://qnfo-subscribers.q08.workers.dev";
async function handleSubscribe(request, env) {
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const ts = await turnstileVerify(env, body && body.cf_turnstile, request.headers.get("CF-Connecting-IP") || "", "ipatent_subscribe");
  if (!ts.ok) return json({ ok: false, error: "Verification failed. Reload the page and try again." }, 403);
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^@\s]{1,64}@[^@\s.]{1,255}\.[^@\s.]{2,}$/.test(email)) return json({ ok: false, error: "Please enter a valid email address." }, 400);
  try {
    const r = await fetch(SUBSCRIBERS_ENDPOINT + "/subscribe", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "qnfo-ipatent/" + VERSION, "X-Forwarded-For": request.headers.get("CF-Connecting-IP") || "", "X-Client-UA": String(request.headers.get("User-Agent") || "").slice(0, 300) }, body: JSON.stringify({ email, hp: String(body.hp || ""), source: "ipatent" }), signal: AbortSignal.timeout(9000) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d && d.ok !== false) return json({ ok: true });
    return json({ ok: false, error: (d && d.error) || "Could not subscribe right now. Please try again." }, r.status >= 400 && r.status < 500 ? r.status : 502);
  } catch (e) { return json({ ok: false, error: "Could not subscribe right now. Please try again." }, 502); }
}
__name(handleSubscribe, "handleSubscribe");
var LLMS_TXT = [
  "# iPatent",
  "",
  "> Free, private-by-default assistant that drafts a US provisional patent disclosure from a plain description and then flags every claim element and value the description never supports. Built by Rowan Brad Quni-Gudzinas (ORCID 0009-0002-4317-5604) at QNFO. Not legal advice.",
  "",
  "## Use it",
  "- [Draft a disclosure](https://ipatent.qnfo.org/): no account; nothing is stored unless the user opts in to a private copy",
  "- [A real run and what it got wrong](https://ipatent.qnfo.org/example): unedited output, the claim-support map, and five invented facts",
  "- [Provisional patent guide](https://ipatent.qnfo.org/guide): what a provisional protects (35 U.S.C. 112(a)), what to include, drawings, fees, why not to publish before filing",
  "- [Before you publish](https://ipatent.qnfo.org/guide/before-you-publish): US grace period vs European absolute novelty, what counts as public",
  "- [Claims in a provisional](https://ipatent.qnfo.org/guide/claims-in-a-provisional): optional, and why the description is what secures the date",
  "- [Drawings](https://ipatent.qnfo.org/guide/drawings): when they are required, what each figure shows, reference numerals",
  "- [Provisional vs nonprovisional](https://ipatent.qnfo.org/guide/provisional-vs-nonprovisional): what each does, costs, and the 12-month link",
  "",
  "## What it does",
  "- Drafts field, background, summary, detailed description (numbered paragraphs), optional claims and abstract",
  "- Support map: each claim element is matched to the numbered paragraph that shares its distinctive terms; any number in a claim absent from the description makes it unsupported",
  "- Completeness checklist while typing: problem, parts, mechanism, values, alternatives, figures",
  "",
  "## Limits",
  "- Drafts are machine-generated and can invent facts; the support check is lexical, not a legal opinion",
  "- No prior-art search; US provisionals only",
  "",
  "## Contact",
  "- [Work with the author](https://qnfo.org/work-with-me): human review, team or tech-transfer versions, collaboration",
  "- Source: https://github.com/QNFO/qnfo-workers/tree/main/qnfo-ipatent"
].join("\n");
var VZ_TOP_K = 8;
var MAX_DESCRIPTION_LEN = 5e3;
var RATE_LIMIT_WINDOW_MS = 60 * 60 * 1e3;
var RATE_LIMIT_MAX = 20;
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Corpus-Token",
  "Access-Control-Max-Age": "86400"
};
function corsHeaders(extra = {}) {
  return { ...CORS, ...extra };
}
__name(corsHeaders, "corsHeaders");
__name2(corsHeaders, "corsHeaders");
__name22(corsHeaders, "corsHeaders");
__name222(corsHeaders, "corsHeaders");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json", "X-Robots-Tag": "noindex" })
  });
}
__name(json, "json");
__name2(json, "json");
__name22(json, "json");
__name222(json, "json");
function html(html2, status = 200) {
  return new Response(html2, {
    status,
    headers: corsHeaders({ "Content-Type": "text/html; charset=utf-8" })
  });
}
__name(html, "html");
__name2(html, "html");
__name22(html, "html");
__name222(html, "html");
function generateId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "USP-";
  const rnd = new Uint8Array(12);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < 12; i++) id += chars[rnd[i] % chars.length];
  return id + "-" + Date.now().toString(36).toUpperCase();
}
__name(generateId, "generateId");
__name2(generateId, "generateId");
__name22(generateId, "generateId");
__name222(generateId, "generateId");
// FLEET-CTL-STATIC-1 (issues 1776, 1777; owner request 1757): the owner's fleet command-line link at the bottom of every
// iPatent page, as static HTML. Not <script src="https://fleet.qnfo.org/ctl.js">: these pages hold an inventor's unfiled
// disclosure text, and a script loaded from a shared, open worker could read it (same decision as personal-api 4.3.2).
// The generated disclosure document (generateHtmlDocument) carries no link: it is what the inventor saves and prints.
function fleetCtlLink(pageUrl) {
  return '<a id="fleet-ctl" href="https://fleet.qnfo.org/cmd?from=' + encodeURIComponent(pageUrl) + '" rel="noopener noreferrer" title="Fleet command line for this page (owner controls need an email code)" aria-label="Fleet command line" style="position:fixed;right:10px;bottom:8px;z-index:2147483000;font:12px/1 system-ui,sans-serif;padding:5px 8px;border-radius:7px;color:#5b6472;background:rgba(127,127,127,.12);text-decoration:none;opacity:.45">&#8984; fleet</a><style>@media print{#fleet-ctl{display:none!important}}</style>';
}
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
__name(escapeHtml, "escapeHtml");
__name2(escapeHtml, "escapeHtml");
__name22(escapeHtml, "escapeHtml");
__name222(escapeHtml, "escapeHtml");
function sanitize(str, maxLen = 1e4) {
  if (!str) return "";
  return String(str).slice(0, maxLen).trim();
}
__name(sanitize, "sanitize");
__name2(sanitize, "sanitize");
__name22(sanitize, "sanitize");
__name222(sanitize, "sanitize");
// DRAFT-ROW-AUTOMATED-1 (3.17.0, failure mode fm-ipatent-automated-drafts-counted): a draft requested by an automated client
// (no user agent, or one PV_BOT matches) is stored with status automated. It still counts toward the rate limit, and
// /api/metrics leaves it out of drafts and drafters, so a probe or the benchmark cannot pass as inventor demand.
function draftRowStatus(request) {
  const ua = request.headers.get("User-Agent") || "";
  return !ua || PV_BOT.test(ua) ? "automated" : "draft";
}
async function checkRateLimit(env, ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const result = await env.IPATENT_DB.prepare(
    "SELECT COUNT(*) as cnt FROM submissions WHERE ip_address = ?1 AND created_at > datetime(?2/1000, 'unixepoch')"
  ).bind(ip, windowStart).first();
  const count = result ? result.cnt : 0;
  return {
    allowed: count < RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - count),
    limit: RATE_LIMIT_MAX
  };
}
__name(checkRateLimit, "checkRateLimit");
__name2(checkRateLimit, "checkRateLimit");
__name22(checkRateLimit, "checkRateLimit");
__name222(checkRateLimit, "checkRateLimit");
async function embedText(env, text) {
  const embedResult = await env.AI.run(AI_EMBED_MODEL, { text });
  const vector = embedResult?.data;
  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    throw new Error("Embedding generation failed");
  }
  return Array.isArray(vector[0]) ? vector[0] : vector;
}
__name(embedText, "embedText");
__name2(embedText, "embedText");
__name22(embedText, "embedText");
__name222(embedText, "embedText");
async function searchDisclosures(env, query, limit = VZ_TOP_K) {
  try {
    const vector = await embedText(env, query);
    const results = await env.DISCLOSURES_VZ.query(vector, {
      topK: limit,
      returnMetadata: "all"
    });
    return (results?.matches || []).map((m) => ({
      id: m.id,
      score: m.score,
      title: m.metadata?.title || "",
      section: m.metadata?.section || "",
      technical_field: m.metadata?.technical_field || "",
      source_file: m.metadata?.source_file || "",
      disclosure_text: m.metadata?.text || m.metadata?.disclosure_text || ""
    }));
  } catch (err) {
    console.error("Vectorize search failed:", err.message);
    return [];
  }
}
__name(searchDisclosures, "searchDisclosures");
__name2(searchDisclosures, "searchDisclosures");
__name22(searchDisclosures, "searchDisclosures");
__name222(searchDisclosures, "searchDisclosures");
async function upsertDraftAudit(env, model, inChars, ms, err, result, purpose) {
  if (!env.AUDIT) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const usage = result && typeof result === "object" ? (result.usage || result.response?.usage || result.choices?.[0]?.usage || null) : null;
    const inTok = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
    const outTok = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
    const neurons = Number(usage?.neurons ?? 0);
    await env.AUDIT.prepare(
      `INSERT INTO ai_call_counters (day, worker, purpose, model, calls, errors, in_chars, ms, in_tok, out_tok, neurons)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(day, worker, purpose, model) DO UPDATE SET
         calls = calls + excluded.calls,
         errors = errors + excluded.errors,
         in_chars = in_chars + excluded.in_chars,
         ms = ms + excluded.ms,
         in_tok = in_tok + excluded.in_tok,
         out_tok = out_tok + excluded.out_tok,
         neurons = neurons + excluded.neurons`
    ).bind(day, "qnfo-ipatent", purpose || "draft", model, 1, err ? 1 : 0, inChars, ms, inTok, outTok, neurons).run();
  } catch (e) {
    console.error("Draft audit upsert failed:", e?.message || e);
  }
}

// ---- IPG-BEGIN: IPATENT-GROUND-1 (owner directive 2026-10-10): a draft states only what the inventor supplied ----
// The model drafts from the inventor's description (and mechanism card) alone. Afterwards the draft is checked against that same
// text: a Background sentence the description does not support is removed and any statement about existing approaches is labelled
// unverified; a sentence in the summary, description or abstract that carries a figure, DOI, link, author citation or patent number
// the inventor did not give is removed; a claim that recites such a figure is removed together with the claims that depend on it;
// the inventor declaration is a fixed text that makes no statement of novelty. Everything removed is listed under SUPPORT GAPS.
var IP_DECLARATION = "To be completed and signed by the inventor. This draft makes no statement that the invention is novel; novelty has not been assessed.";
var IP_BACKGROUND_NONE = "Not stated by the inventor. Describe the problem or limitation this invention addresses, in your own words, and redraft.";
var IP_PRIOR_LABEL = " (Stated by the inventor; not verified against the prior art.)";
var IP_STD_HEADINGS = ["TITLE OF INVENTION", "TECHNICAL FIELD", "BACKGROUND", "SUMMARY OF THE INVENTION", "DETAILED DESCRIPTION", "CLAIMS", "ABSTRACT", "BRIEF DESCRIPTION OF THE DRAWINGS", "INVENTOR DECLARATION", "SUPPORT GAPS", "CROSS-REFERENCE TO RELATED APPLICATIONS", "FIELD OF THE INVENTION", "SUMMARY", "DESCRIPTION OF EMBODIMENTS"];
// Section headings only, in the order the retrieved disclosures use them. No title, field, text or noun of any disclosure.
function ipStructureReference(ragContext) {
  var seen = [];
  (ragContext || []).forEach(function (r) {
    String(r && r.disclosure_text || "").split("\n").forEach(function (line) {
      var h = line.replace(/^[\s#*\d.)]+/, "").replace(/[\s*:]+$/, "").toUpperCase();
      if (IP_STD_HEADINGS.indexOf(h) >= 0 && seen.indexOf(h) < 0) seen.push(h);
    });
  });
  return seen;
}
function ipNums(text) {
  var set = new Set();
  (String(text || "").match(/\d[\d,]*(?:\.\d+)?/g) || []).forEach(function (n) { set.add(n.replace(/,/g, "").replace(/\.0+$/, "")); });
  return set;
}
function ipWordSet(text) {
  var set = new Set();
  String(text || "").toLowerCase().replace(/[a-z][a-z-]{3,}/g, function (w) { set.add(w); set.add(w.replace(/(ing|ed|es|s)$/, "")); return ""; });
  return set;
}
// Identifiers and figures in `sent` that the supplied text does not contain.
function ipSentenceProblems(sent, gl, gnums) {
  var out = [];
  var s = String(sent).replace(/\bclaims?\s+\d+(?:\s*(?:,|and|or|to|-)\s*\d+)*/gi, " ").replace(/^\s*\d{1,3}\s*[.)]\s+/, " ");
  (s.match(/\b10\.\d{4,9}\/[^\s"<>)\]]+/g) || []).forEach(function (d) { d = d.replace(/[.,;:]+$/, "").toLowerCase(); if (gl.indexOf(d) < 0) out.push("doi: " + d); });
  (s.match(/https?:\/\/[^\s)<>\]"]+/gi) || []).forEach(function (u) { if (gl.indexOf(u.toLowerCase().replace(/[.,;:)\]]+$/, "").replace(/\/+$/, "")) < 0) out.push("link: " + u); });
  if (/\bet al\b/i.test(s) && gl.indexOf("et al") < 0) out.push("author citation: et al");
  (s.match(/\b(?:novel|novelty|unprecedented|unique|never before|first of its kind)\b/gi) || []).forEach(function (w) { if (gl.indexOf(w.toLowerCase()) < 0) out.push("novelty statement: " + w); });
  var body = s.replace(/10\.\d{4,9}\/\S+/g, " ").replace(/https?:\/\/\S+/gi, " ");
  var re = /(\$?)(\d[\d,]*(?:\.\d+)?)(\s*(?:%|percent|[a-z]{1,}\b)?)/gi, m;
  while ((m = re.exec(body))) {
    var num = m[2].replace(/,/g, "").replace(/\.0+$/, "");
    if (gnums.has(num)) continue;
    if (/^\d{1,2}$/.test(num) && Number(num) <= 10 && !m[1] && !/^(%|percent)$/i.test((m[3] || "").trim())) continue;
    out.push("figure: " + (m[1] + m[2] + " " + (m[3] || "")).trim());
  }
  return out;
}
function ipSplitSentences(text) { return String(text || "").split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/); }
var IP_PRIOR_RE = /\b(prior art|state of the art|in the art|known|existing|conventional|traditional|traditionally|typically|commonly|widely|previously|others have|current(?:ly)?|today)\b/i;
// Background: keep a sentence only when the supplied text carries it (at least 60 percent of its content words); label statements
// about existing approaches as the inventor's, unverified.
function ipGroundBackground(text, ground) {
  var words = ipWordSet(ground), gl = String(ground || "").toLowerCase(), gnums = ipNums(ground), kept = [], removed = 0;
  String(text || "").split("\n").forEach(function (line) {
    ipSplitSentences(line).forEach(function (sn) {
      if (!sn.trim()) return;
      var cw = (sn.toLowerCase().match(/[a-z][a-z-]{4,}/g) || []);
      var hit = cw.filter(function (w) { return words.has(w) || words.has(w.replace(/(ing|ed|es|s)$/, "")); }).length;
      var unsupported = ipSentenceProblems(sn, gl, gnums).length > 0 || (cw.length >= 3 && hit / cw.length < 0.6);
      if (unsupported) { removed++; return; }
      if (IP_PRIOR_RE.test(sn) && sn.indexOf("not verified against the prior art") < 0) sn = sn.replace(/\s+$/, "") + IP_PRIOR_LABEL;
      kept.push(sn);
    });
  });
  return { text: kept.length ? kept.join(" ") : IP_BACKGROUND_NONE, removed: removed };
}
function ipGroundNarrative(text, ground) {
  var gl = String(ground || "").toLowerCase(), gnums = ipNums(ground), removed = 0;
  var lines = String(text || "").split("\n").map(function (line) {
    if (!line.trim()) return line;
    var lead = (line.match(/^\s*(?:[-*+]\s+|\d{1,2}[.)]\s+)?/) || [""])[0], kept = [];
    ipSplitSentences(line.slice(lead.length)).forEach(function (sn) { if (ipSentenceProblems(sn, gl, gnums).length) removed++; else kept.push(sn); });
    return kept.length ? lead + kept.join(" ") : "";
  });
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed: removed };
}
// Claims: a claim reciting an unsupported figure or identifier goes, and so does every claim that depends on it.
function ipGroundClaims(text, ground) {
  var gl = String(ground || "").toLowerCase(), gnums = ipNums(ground);
  var lines = String(text || "").split("\n"), claims = [], loose = [];
  lines.forEach(function (line) {
    var m = line.match(/^\s*\**\s*(\d{1,3})\s*[.)]/);
    if (m) claims.push({ n: Number(m[1]), text: line, dead: false, deps: (line.match(/\bclaims?\s+(\d+)/gi) || []).map(function (x) { return Number(x.replace(/\D/g, "")); }) });
    else if (claims.length) claims[claims.length - 1].text += "\n" + line;
    else loose.push(line);
  });
  if (!claims.length) return { text: text, removedClaims: [], problems: [] };
  var problems = [];
  claims.forEach(function (c) { var p = ipSentenceProblems(c.text, gl, gnums); if (p.length) { c.dead = true; problems.push("claim " + c.n + ": " + p.slice(0, 2).join(", ")); } });
  var changed = true;
  while (changed) { changed = false; claims.forEach(function (c) { if (!c.dead && c.deps.some(function (d) { return claims.some(function (o) { return o.n === d && o.dead; }); })) { c.dead = true; changed = true; problems.push("claim " + c.n + ": depends on a removed claim"); } }); }
  return { text: loose.concat(claims.filter(function (c) { return !c.dead; }).map(function (c) { return c.text; })).join("\n").trim(), removedClaims: claims.filter(function (c) { return c.dead; }).map(function (c) { return c.n; }), problems: problems };
}
// Applies the checks to the parsed sections. `ground` is the inventor's text: title, field, description and mechanism card values.
function ipGroundSections(sections, ground) {
  var out = Object.assign({}, sections), notes = [];
  if (out.background !== undefined) {
    var b = ipGroundBackground(out.background, ground); out.background = b.text;
    if (b.removed) notes.push(b.removed + " Background sentence(s) removed: the description you supplied does not state them. Add the problem and the approaches you know of, in your own words.");
  }
  ["summary", "detailed_description", "abstract", "technical_field"].forEach(function (k) {
    if (!out[k]) return;
    var r = ipGroundNarrative(out[k], ground); out[k] = r.text;
    if (r.removed) notes.push(r.removed + " sentence(s) removed from " + k.replace(/_/g, " ") + ": each carried a figure, identifier or citation that is not in your description.");
  });
  if (out.raw) { out.raw = ipGroundNarrative(out.raw, ground).text; out.claims = out.raw; }
  else if (out.claims) {
    var c = ipGroundClaims(out.claims, ground); out.claims = c.text;
    if (c.removedClaims.length) notes.push("Claim(s) " + c.removedClaims.join(", ") + " removed (" + c.problems.join("; ") + "). Give the missing values in your description, redraft, and renumber the remaining claims before filing.");
  }
  out.declaration = IP_DECLARATION;
  if (notes.length) out.support_gaps = (out.support_gaps ? out.support_gaps + "\n" : "") + notes.map(function (n) { return "- " + n; }).join("\n");
  Object.defineProperty(out, "__grounding", { value: notes, enumerable: false });
  if (sections && sections.__attempts) Object.defineProperty(out, "__attempts", { value: sections.__attempts, enumerable: false });
  return out;
}
// ---- IPG-END ----
async function draftDisclosure(env, { title, technicalField, description, ragContext, mechanism }) {
  const structure = ipStructureReference(ragContext);
  const structureText = structure.length ? structure.join("\n") : "No similar disclosures found in the database.";
  const prompt = `You are an expert US patent drafter. Write a professional US Provisional Patent Disclosure from the inventor's description below, and only from it.

## INVENTOR'S DESCRIPTION
Title: ${title}
Technical Field: ${technicalField || "Not specified"}
Description: ${description}${mechanismBlock(mechanism)}

## STRUCTURE REFERENCE (section headings used by similar disclosures; structure only, it carries no content)
${structureText}

## REQUIRED OUTPUT FORMAT
Output the disclosure with these numbered sections:

## 1. TITLE OF INVENTION
[Exact title]

## 2. TECHNICAL FIELD
[1-3 sentences describing the field of the invention]

## 3. BACKGROUND
[2-4 sentences stating the problem or limitation, using only what the inventor wrote. State no prior art, known product, publication, patent, date or figure that the inventor did not name. A statement about existing approaches must be one the inventor made, and ends with "(Stated by the inventor; not verified against the prior art.)". If the description states no problem, write "Not stated by the inventor."]

## 4. SUMMARY OF THE INVENTION
[4-8 sentences summarizing what the invention is and the effect the description states. Make no statement that it is new, better or unique.]

## 5. DETAILED DESCRIPTION
[5-12 sentences describing how the invention works, its components, and implementation details. Use only components, steps, values and ranges that the description or mechanism card states; where detail is missing, say it is not described and list it under SUPPORT GAPS. Add no number, standard or named product that the inventor did not give.]

## 6. CLAIMS
[List 8-15 numbered patent claims in standard USPTO format:
- Claim 1 should be the broadest independent claim
- Subsequent claims should add specific limitations and dependencies
- Use "A method/system/apparatus comprising:" format for independent claims
- Use "The method of claim X, further comprising:" for dependent claims
- Use a claim category (method, system, apparatus, computer-readable medium) only where the description supports it
- Every limitation in a claim, including every number, comes from the description]

## 7. ABSTRACT
[150-250 word abstract summarizing the invention, what the description states it does, and the advantage the description states]

## 8. INVENTOR DECLARATION
[Write exactly: ${IP_DECLARATION}]

## 9. SUPPORT GAPS
[A bullet list for the inventor, not for filing: each feature, variant or claim element that the description mentions but does not explain well enough for a skilled person to make and use it; each drawing the specification should include and what it should show; and any statement in the draft that goes beyond what the inventor described. Be specific; if there are none, say so.]

IMPORTANT:
- Write ONLY from the inventor's description and mechanism card. Your memory is not a source: add no prior art, publication, patent number, standard, product, date or figure that the inventor did not state.
- Use formal patent language appropriate for USPTO filings.
- Be specific and concrete \u2014 avoid vague generalities.
- The claims are the most important section \u2014 make them detailed and defensible.
- Claim the engineered means (the structure or steps) that produces the effect, never a law of nature, a mathematical relation or the result itself.
- Every functional phrase in a claim names the structure that performs it.
- Claim a range only as wide as the description teaches how to achieve; otherwise list the gap under SUPPORT GAPS.`;
  let lastError = null;
  let text = "";
  const attempts = [];
  const t0 = Date.now();
  for (const model of AI_DRAFT_MODELS) {
    const left = DRAFT_BUDGET_MS - (Date.now() - t0);
    if (left < DRAFT_MIN_ATTEMPT_MS) { attempts.push({ model, ms: 0, outcome: "skipped: budget spent" }); continue; }
    const ta = Date.now();
    const opts = {
      messages: [
        { role: "system", content: "You are an expert US patent attorney and drafter. Write formal, precise, and defensible patent disclosures. Output only the disclosure text \u2014 no preamble or meta-commentary.\n\nADVERSARIAL-REASONING-1 (anti-sycophancy / anti-confirmation-bias): never flatter, defer, or agree with the user or a source merely because it was stated - when evidence contradicts the premise, say so plainly with counter-evidence; expose at least one concrete limitation or failure mode in the drafted output, in the SUPPORT GAPS section; label uncertainty, never inflate confidence." },
        { role: "user", content: prompt }
      ],
      max_tokens: 8e3,
      temperature: 0.5
    };
    if (DRAFT_EFFORT[model]) opts.reasoning_effort = DRAFT_EFFORT[model];
    const inChars = opts.messages.reduce((sum, m) => sum + String(m.content || "").length, 0);
    try {
      let timer;
      const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("deadline " + Math.min(DRAFT_ATTEMPT_MS, left) + " ms")), Math.min(DRAFT_ATTEMPT_MS, left)); });
      let result;
      try { result = await Promise.race([env.AI.run(model, opts), deadline]); } finally { clearTimeout(timer); }
      await upsertDraftAudit(env, model, inChars, Date.now() - ta, null, result);
      text = typeof result === "string" ? result : (result?.response || result?.choices?.[0]?.message?.content || "");
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      const sectionCount = ["TITLE OF INVENTION", "TECHNICAL FIELD", "BACKGROUND", "SUMMARY", "DETAILED DESCRIPTION", "CLAIMS", "ABSTRACT"].filter(
        (s) => text.includes(s)
      ).length;
      if (text && sectionCount >= 3) { attempts.push({ model, ms: Date.now() - ta, outcome: "ok", sections: sectionCount }); break; }
      if (text) {
        lastError = `Model ${model} produced non-compliant output (${sectionCount}/7 sections)`;
        attempts.push({ model, ms: Date.now() - ta, outcome: "non-compliant", sections: sectionCount });
        console.error(lastError);
        text = "";
      } else {
        lastError = `Empty response from ${model}`;
        attempts.push({ model, ms: Date.now() - ta, outcome: "empty" });
      }
    } catch (err) {
      await upsertDraftAudit(env, model, inChars, Date.now() - ta, err, null);
      lastError = `${model}: ${err.message}`;
      attempts.push({ model, ms: Date.now() - ta, outcome: "error: " + String(err && err.message || err).slice(0, 120) });
      console.error(`Model ${model} failed:`, err.message);
    }
  }
  if (!text) { const e = new Error(`All models failed. Last error: ${lastError}`); e.attempts = attempts; throw e; }
  // IPATENT-COST-PER-DRAFT-1: one row per completed draft (no model, no tokens; ms is the whole drafting time), the denominator of /api/cost.
  await upsertDraftAudit(env, COST_DONE_MODEL, 0, Date.now() - t0, null, null, "draft-done");
  const parsed = parseDisclosureSections(text);
  Object.defineProperty(parsed, "__attempts", { value: attempts, enumerable: false });
  // IPATENT-GROUND-1: check the draft against the inventor's own text before anyone sees it.
  const ground = [title, technicalField, description, mechanism ? MECH_FIELDS.map((f) => mechanism[f[0]]).join("\n") : ""].join("\n");
  return ipGroundSections(parsed, ground);
}
__name(draftDisclosure, "draftDisclosure");
__name2(draftDisclosure, "draftDisclosure");
__name22(draftDisclosure, "draftDisclosure");
__name222(draftDisclosure, "draftDisclosure");
function parseDisclosureSections(text) {
  text = text.replace(/\*\*(\s*\d+\.\s*[A-Z][^*\n]*?)\s*\*\*/g, "## $1").replace(/^\s*##\s*([A-Z][^\n]*?)\s*$/gm, (m, t) => {
    return /^\d+\./.test(t.trim()) ? m : m;
  });
  const sections = {};
  const patterns = [
    { key: "title", regex: /(?:##\s*)?1\.?\s*TITLE\s*OF\s*INVENTION\s*\n+(.+?)(?=\n*(?:##\s*)?2\.)/si },
    { key: "technical_field", regex: /(?:##\s*)?2\.?\s*TECHNICAL\s*FIELD\s*\n+(.+?)(?=\n*(?:##\s*)?3\.)/si },
    { key: "background", regex: /(?:##\s*)?3\.?\s*BACKGROUND\s*\n+(.+?)(?=\n*(?:##\s*)?4\.)/si },
    { key: "summary", regex: /(?:##\s*)?4\.?\s*SUMMARY\s*(?:OF\s*THE\s*INVENTION)?\s*\n+(.+?)(?=\n*(?:##\s*)?5\.)/si },
    { key: "detailed_description", regex: /(?:##\s*)?5\.?\s*DETAILED\s*DESCRIPTION\s*\n+(.+?)(?=\n*(?:##\s*)?6\.)/si },
    { key: "claims", regex: /(?:##\s*)?6\.?\s*CLAIMS\s*\n+(.+?)(?=\n*(?:##\s*)?7\.)/si },
    { key: "abstract", regex: /(?:##\s*)?7\.?\s*ABSTRACT\s*\n+(.+?)(?=\n*(?:##\s*)?8\.)/si },
    { key: "declaration", regex: /(?:##\s*)?8\.?\s*INVENTOR\s*DECLARATION\s*\n+(.+?)(?=\n*(?:##\s*)?9\.|$)/si },
    { key: "support_gaps", regex: /(?:##\s*)?9\.?\s*SUPPORT\s*GAPS\s*\n+(.+?)$/si }
  ];
  for (const { key, regex } of patterns) {
    const match = text.match(regex);
    sections[key] = match ? match[1].trim() : "";
  }
  if (!sections.title && !sections.claims) {
    sections.raw = text;
    sections.claims = text;
  }
  return sections;
}
__name(parseDisclosureSections, "parseDisclosureSections");
__name2(parseDisclosureSections, "parseDisclosureSections");
__name22(parseDisclosureSections, "parseDisclosureSections");
__name222(parseDisclosureSections, "parseDisclosureSections");
function formatClaims(claimsText) {
  const lines = claimsText.split(/\n/);
  let html2 = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d+\./.test(trimmed)) {
      html2 += `<div class="claim"><strong>${escapeHtml(trimmed)}</strong></div>
`;
    } else {
      html2 += `<div class="claim">${escapeHtml(trimmed)}</div>
`;
    }
  }
  return html2 || escapeHtml(claimsText);
}
__name(formatClaims, "formatClaims");
__name2(formatClaims, "formatClaims");
__name22(formatClaims, "formatClaims");
__name222(formatClaims, "formatClaims");
function generateHtmlDocument({ submissionId, title, inventorName, inventorEmail, sections, date, paragraphs, supportMapData }) {
  const esc = escapeHtml;
  const paras = paragraphs || [];
  const specBlock = (key, heading) => {
    const ps = paras.filter((p) => p.key === key);
    if (ps.length) return `<h2>${heading}</h2><div class="section">${ps.map((p) => `<p class="para"><span class="pn">${paraNo(p.n)}</span> ${esc(p.text)}</p>`).join("")}</div>`;
    return sections[key] ? `<h2>${heading}</h2><div class="section">${esc(sections[key])}</div>` : "";
  };
  const sm = supportMapData;
  const smBlock = sm && sm.rows && sm.rows.length ? `<h2>Reviewer notes: support map (remove before filing)</h2><div class="section sm"><p>${sm.supported} of ${sm.elements} claim elements are worded in a numbered paragraph; ${sm.weak} partly; ${sm.unsupported} not at all. Method: ${esc(sm.method)}.</p><table><tr><th>Claim</th><th>Element</th><th>Best paragraph</th><th>Status</th><th>Terms not found</th></tr>${sm.rows.map((r) => `<tr class="${r.status}"><td>${r.claim}</td><td>${esc(r.element)}</td><td>${r.paragraph ? paraNo(r.paragraph) : "none"}</td><td>${r.status} (${Math.round(r.coverage * 100)}%)</td><td>${esc([].concat((r.missing_values || []).map((v) => "value " + v), r.missing_terms || []).join(", "))}</td></tr>`).join("")}</table></div>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>US Provisional Disclosure \u2014 ${esc(title)}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px;color:#1a1a2e;line-height:1.7}
  h1{font-size:1.5rem;border-bottom:3px solid #4f46e5;padding-bottom:10px}
  h2{font-size:1.1rem;color:#4f46e5;margin-top:24px}
  .meta{background:#f3f4f6;padding:16px;border-radius:8px;margin:16px 0;font-size:.9rem}
  .section{background:#fefefe;border:1px solid #e5e7eb;padding:20px 24px;border-radius:8px;margin:16px 0;white-space:pre-wrap;line-height:1.8}
  .claims .claim{margin:8px 0;padding:6px 0;border-bottom:1px dotted #e5e7eb}
  .footer{font-size:.75rem;color:#9ca3af;margin-top:40px;border-top:1px solid #e5e7eb;padding-top:16px}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-25deg);font-size:6rem;color:rgba(79,70,229,.03);pointer-events:none;z-index:-1;white-space:nowrap}
  .para{margin:0 0 10px;white-space:pre-wrap}.pn{font-weight:600;color:#4f46e5;margin-right:6px}
  .section.sm{white-space:normal}.sm table{border-collapse:collapse;width:100%;font-size:.85rem}.sm th,.sm td{border:1px solid #e5e7eb;padding:6px;text-align:left;vertical-align:top}
  .sm tr.unsupported td{background:#fdecea}.sm tr.weak td{background:#fff7e0}
  @media print{.watermark{display:none}body{font-size:11pt}}
</style>
</head>
<body>
<div class="watermark">DRAFT</div>
<h1>UNITED STATES PROVISIONAL PATENT DISCLOSURE</h1>
<div class="meta">
  <p><strong>Submission ID:</strong> ${esc(submissionId)}</p>
  <p><strong>Date Generated:</strong> ${esc(date)}</p>
  <p><strong>Inventor:</strong> ${esc(inventorName || "Not provided")}</p>
  <p><strong>Contact:</strong> ${esc(inventorEmail || "Not provided")}</p>
  <p><strong>Status:</strong> DRAFT \u2014 Not yet filed with USPTO</p>
</div>
<h2>1. Title of Invention</h2>
<p>${esc(title)}</p>
${specBlock("technical_field", "2. Technical Field")}
${specBlock("background", "3. Background")}
${specBlock("summary", "4. Summary of the Invention")}
${specBlock("detailed_description", "5. Detailed Description")}
${sections.claims ? `<h2>6. Claims</h2><div class="section claims">${formatClaims(sections.claims)}</div>` : ""}
${sections.abstract ? `<h2>7. Abstract</h2><div class="section">${esc(sections.abstract)}</div>` : ""}
${sections.declaration ? `<h2>8. Inventor Declaration</h2><div class="section">${esc(sections.declaration)}</div>` : ""}
${smBlock}
${sections.support_gaps ? `<h2>Reviewer notes: support gaps (remove before filing)</h2><div class="section" style="border-color:#a97b1d">${esc(sections.support_gaps)}</div>` : ""}
<h2>Next Steps</h2>
<ol>
  <li>Review and refine this disclosure carefully</li>
  <li>Add drawings wherever they help a skilled reader understand the invention (35 U.S.C. 113)</li>
  <li>Check that every feature you may later claim is described here: a provisional only secures priority for what it discloses</li>
  <li>File as a USPTO provisional application (cover sheet SB/16, specification, drawings, fee)</li>
  <li>Consult a registered patent attorney or agent before filing</li>
</ol>
<div class="footer">
  <p>Generated by ipatent.qnfo.org \u2014 a free experimental drafting assistant from QNFO. Machine-generated; review every sentence.</p>
  <p>This is NOT a filed patent application. No USPTO filing date has been established.</p>
  <p>Generated: ${esc(date)} | Submission ID: ${esc(submissionId)}</p>
</div>
</body>
</html>`;
}
__name(generateHtmlDocument, "generateHtmlDocument");
__name2(generateHtmlDocument, "generateHtmlDocument");
__name22(generateHtmlDocument, "generateHtmlDocument");
__name222(generateHtmlDocument, "generateHtmlDocument");
// ---- MECHANISM-FIRST-1:BEGIN (agent_issues 2053; owner principle 2026-10-06: a defensible patent is engineerable physics -
// what it is, what it does, how it works, and the distinction that makes the difference). POST /api/mechanism reads the
// inventor's description into a mechanism card the inventor corrects before drafting; POST /api/draft with that card
// derives the claims from it (independent claim = the distinction plus the minimum structure across the operating window;
// dependents narrow inside the window). The card records only what the inventor wrote: a field the description does not
// support is NOT STATED and becomes a hole for the inventor to fill, never an invented mechanism.
var MECH_FIELDS = [
  ["what_it_is", "What it is", "the structure: the parts or steps and how they connect"],
  ["what_it_does", "What it does", "the technical effect, measurable, with units or a comparison to the known approach"],
  ["how_it_works", "How it works", "the causal principle that makes the structure produce the effect, and which quantity changes and why"],
  ["distinction", "The distinction that makes the difference", "the one feature without which the effect disappears"],
  ["nearest_known", "Nearest known approach", "the closest existing approach the inventor names, and how it differs"],
  ["window_holds", "Operating window", "the parameter ranges over which the mechanism still works"],
  ["window_breaks", "Where it breaks", "where the mechanism stops working, and why"]
];
var MECH_NOT_STATED = "NOT STATED";
var MECH_FIELD_MAX = 700;
var MECH_ATTEMPT_MS = 30000;
function mechanismPrompt(title, technicalField, description) {
  return "Read the inventor's description and fill a mechanism card as JSON. Use ONLY what the description states or "
    + "directly implies. If the description does not state a field, write exactly \"" + MECH_NOT_STATED + "\" for it - "
    + "never invent a mechanism, a number, a range or a prior-art reference. Keep each value under 80 words, plain text.\n\n"
    + "Fields:\n" + MECH_FIELDS.map(function (f) { return "- " + f[0] + ": " + f[2]; }).join("\n")
    + "\n\nOutput only one JSON object with exactly these keys, no prose, no code fence.\n\n"
    + "Title: " + title + "\nTechnical field: " + (technicalField || "Not specified") + "\nDescription: " + description;
}
function normalizeMechanism(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  var out = {}, any = false;
  for (var i = 0; i < MECH_FIELDS.length; i++) {
    var k = MECH_FIELDS[i][0], v = raw[k];
    v = v == null ? "" : String(typeof v === "object" ? JSON.stringify(v) : v).replace(/\s+/g, " ").trim().slice(0, MECH_FIELD_MAX);
    if (!v || /^(not stated|n\/?a|none|unknown|unspecified|-)\.?$/i.test(v)) v = MECH_NOT_STATED;
    if (v !== MECH_NOT_STATED) any = true;
    out[k] = v;
  }
  return any ? out : null;
}
function parseMechanism(text) {
  var t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return normalizeMechanism(JSON.parse(t.slice(a, b + 1))); } catch (e) { return null; }
}
// Holes the inventor should fill before filing. Deterministic: a field NOT STATED, an effect with no number, unit or
// comparison, and a mechanism that only names a result ("it works better") are holes.
var MECH_MEASURABLE = /\d|percent|%|\b(?:faster|slower|lower|higher|less|more|fewer|reduc\w*|increas\w*|lighter|cheaper|stronger|smaller|larger)\b/i;
function mechanismHoles(card) {
  var holes = [];
  if (!card) return [{ field: "all", why: "no mechanism card: describe what the invention is, what it does and how it works" }];
  for (var i = 0; i < MECH_FIELDS.length; i++) {
    var f = MECH_FIELDS[i];
    if (card[f[0]] === MECH_NOT_STATED) holes.push({ field: f[0], why: f[1] + " is not stated: " + f[2] + "." });
  }
  if (card.what_it_does !== MECH_NOT_STATED && !MECH_MEASURABLE.test(card.what_it_does)) holes.push({ field: "what_it_does", why: "The effect is not measurable as written: give a number, a unit or a comparison with the known approach." });
  if (card.distinction !== MECH_NOT_STATED && card.nearest_known === MECH_NOT_STATED) holes.push({ field: "distinction", why: "The distinction cannot be checked without the nearest known approach: a feature that is already common in the field does not make the difference. Name what exists and what yours adds to it." });
  if (card.how_it_works !== MECH_NOT_STATED && card.how_it_works.split(/\s+/).length < 8) holes.push({ field: "how_it_works", why: "The mechanism is too short to teach a skilled person how the structure produces the effect." });
  return holes;
}
function mechanismBlock(card) {
  if (!card) return "";
  var lines = MECH_FIELDS.map(function (f) { return "- " + f[1] + ": " + card[f[0]]; }).join("\n");
  return "\n\n## MECHANISM CARD (confirmed by the inventor; fields marked " + MECH_NOT_STATED + " are open)\n" + lines
    + "\n\n## CLAIM DERIVATION FROM THE MECHANISM CARD\n"
    + "- Claim 1 recites the distinction that makes the difference plus only the minimum structure needed for it to produce the stated effect, and covers the whole operating window, not one preferred value.\n"
    + "- Dependent claims narrow inside the window: preferred sub-ranges, materials, alternative embodiments, and the nearest-known-approach contrast where it adds a limitation.\n"
    + "- The detailed description explains how it works (the causal principle) and teaches at least one way to achieve the effect at each end of the claimed window; if it cannot, list that under SUPPORT GAPS instead of claiming the full window.\n"
    + "- A field marked " + MECH_NOT_STATED + " is not filled in by you: list it under SUPPORT GAPS.";
}
async function handleMechanism(request, env, ctx) {
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  var body;
  try { body = await request.json(); } catch (e) { return json({ error: "Invalid JSON body" }, 400); }
  var title = sanitize(body && body.title, 300), technicalField = sanitize(body && body.technical_field, 300), description = sanitize(body && body.description, MAX_DESCRIPTION_LEN);
  if (!title || !description || description.length < 50) return json({ error: "title and description (min 50 chars) are required" }, 400);
  var ua = request.headers.get("User-Agent") || "";
  if (!ua || PV_BOT.test(ua)) return json({ error: "Mechanism cards are for people drafting an invention; automated clients are not served." }, 403);
  var ip = await hashIp(request.headers.get("CF-Connecting-IP") || "unknown");
  var rateLimit = await checkRateLimit(env, ip);
  if (!rateLimit.allowed) return json({ error: "Rate limit exceeded. Please try again later.", rate_limit: rateLimit }, 429);
  try {
    var day = await env.IPATENT_DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM usage_counts WHERE day = date('now') AND kind = 'mechanism'").first();
    if (day && Number(day.n) >= DAILY_DRAFT_CAP) return json({ error: "iPatent has reached its daily limit for mechanism cards. Please try again later." }, 429);
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-ipatent", where: "handleMechanism", error: String(e && e.message || e) })); }
  await countUsage(env, "mechanism", title + " " + technicalField + " " + description.slice(0, 1e3), ua);
  var prompt = mechanismPrompt(title, technicalField, description), attempts = [], card = null, t0 = Date.now();
  for (var i = 0; i < AI_DRAFT_MODELS.length && !card; i++) {
    var model = AI_DRAFT_MODELS[i], left = DRAFT_BUDGET_MS - (Date.now() - t0);
    if (left < DRAFT_MIN_ATTEMPT_MS) { attempts.push({ model: model, outcome: "skipped: budget spent" }); continue; }
    var ta = Date.now(), timer = null;
    try {
      var opts = { messages: [{ role: "system", content: "You extract facts from an inventor's description into JSON. You never add facts the inventor did not state." }, { role: "user", content: prompt }], max_tokens: 1800, temperature: 0.1 };
      if (DRAFT_EFFORT[model]) opts.reasoning_effort = DRAFT_EFFORT[model];
      var deadline = new Promise(function (_, rej) { timer = setTimeout(function () { rej(new Error("deadline")); }, Math.min(MECH_ATTEMPT_MS, left)); });
      var result;
      try { result = await Promise.race([env.AI.run(model, opts), deadline]); } finally { clearTimeout(timer); }
      await upsertDraftAudit(env, model, prompt.length, Date.now() - ta, null, result, "mechanism");
      var text = typeof result === "string" ? result : (result && (result.response || (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content))) || "";
      card = parseMechanism(text);
      attempts.push({ model: model, ms: Date.now() - ta, outcome: card ? "ok" : "unparseable" });
    } catch (err) {
      await upsertDraftAudit(env, model, prompt.length, Date.now() - ta, err, null, "mechanism");
      attempts.push({ model: model, ms: Date.now() - ta, outcome: "error: " + String(err && err.message || err).slice(0, 120) });
    }
  }
  if (!card) return json({ error: "Could not read a mechanism from the description. Add what the invention is, what it does and how it works, then try again.", attempts: attempts }, 503);
  return json({ mechanism: card, holes: mechanismHoles(card), fields: MECH_FIELDS.map(function (f) { return { key: f[0], label: f[1], asks: f[2] }; }), attempts: attempts, rate_limit: rateLimit });
}
// ---- MECHANISM-FIRST-1:END
async function handleDraft(request, env, ctx) {
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const title = sanitize(body.title, 300);
  const technicalField = sanitize(body.technical_field, 300);
  const description = sanitize(body.description, MAX_DESCRIPTION_LEN);
  const inventorName = sanitize(body.inventor_name, 200);
  const inventorEmail = sanitize(body.inventor_email, 200);
  const keepCopy = body.save === true;
  const mechanism = normalizeMechanism(body.mechanism);
  if (!title || !description || description.length < 50) {
    return json({ error: "title and description (min 50 chars) are required" }, 400);
  }
  const ts = await turnstileVerify(env, body.cf_turnstile, request.headers.get("CF-Connecting-IP") || "", "ipatent_draft");
  if (!ts.ok) return json({ error: "Verification failed. Reload the page and try again." }, 403);
  const ip = await hashIp(request.headers.get("CF-Connecting-IP") || "unknown");
  const rateLimit = await checkRateLimit(env, ip);
  try {
    const day = await env.IPATENT_DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE created_at > datetime('now', '-1 day')").first();
    if (day && Number(day.n) >= DAILY_DRAFT_CAP) return json({ error: "iPatent has reached its daily drafting limit (" + DAILY_DRAFT_CAP + " drafts in 24 hours). Please try again later." }, 429);
  } catch (e) { console.error(JSON.stringify({ worker: "qnfo-ipatent", where: "handleDraft", error: String(e && e.message || e) })); }
  if (!rateLimit.allowed) {
    return json({ error: "Rate limit exceeded. Please try again later.", rate_limit: rateLimit }, 429);
  }
  const searchQuery = `${title} ${technicalField} ${description.slice(0, 1e3)}`;
  ctx?.waitUntil?.(countUsage(env, "draft", searchQuery, request.headers.get("User-Agent") || ""));
  if (body.variant === "v2") ctx?.waitUntil?.(countUsage(env, "draft-v2", searchQuery, request.headers.get("User-Agent") || ""));
  const ragContext = await searchDisclosures(env, searchQuery);
  const topRag = ragContext && ragContext.length ? ragContext[0] : null;
  const priorArt = topRag && Number(topRag.score) >= 0.8 ? { flag: true, top_title: topRag.title, top_score: Math.round(Number(topRag.score) * 100) / 100, section: topRag.section || "", message: "Very close to an existing corpus filing - refine the distinguishing features before filing." } : null;
  let sections;
  try {
    sections = await draftDisclosure(env, { title, technicalField, description, ragContext, mechanism });
  } catch (err) {
    return json({ error: "AI drafting failed: " + err.message, attempts: err.attempts || [] }, 503);
  }
  const submissionId = generateId();
  const now = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const paragraphs = specParagraphs(sections);
  const supportMapData = supportMap(sections.claims || "", paragraphs);
  const documentHtml = generateHtmlDocument({ submissionId, title, inventorName, inventorEmail, sections, date: now, paragraphs, supportMapData });
  const disclosureText = [
    sections.title,
    sections.technical_field,
    sections.background,
    sections.summary,
    sections.detailed_description,
    sections.claims,
    sections.abstract
  ].filter(Boolean).join("\n\n");
  const r2Key = "disclosures/" + submissionId + ".html";
  const ua = keepCopy ? (request.headers.get("User-Agent") || "").slice(0, 120) : null;
  const country = request.headers.get("CF-IPCountry") || "XX";
  const sessionId = crypto.randomUUID();
  try {
    await env.IPATENT_DB.prepare(`
      INSERT INTO submissions (submission_id, inventor_name, inventor_email, title,
        disclosure_text, document_html, r2_key, status, ip_address, user_agent, country,
        session_id, technical_field, abstract, claims, summary, background)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?17, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
    `).bind(
      submissionId,
      keepCopy ? inventorName : null,
      keepCopy ? inventorEmail : null,
      keepCopy ? title : "[private]",
      keepCopy ? disclosureText : "",
      keepCopy ? documentHtml : null,
      keepCopy ? r2Key : null,
      ip,
      ua,
      country,
      sessionId,
      keepCopy ? sections.technical_field || null : null,
      keepCopy ? sections.abstract || null : null,
      keepCopy ? sections.claims || null : null,
      keepCopy ? sections.summary || null : null,
      keepCopy ? sections.background || null : null,
      draftRowStatus(request)
    ).run();
  } catch (err) {
    console.error("D1 insert failed:", err.message);
  }
  if (keepCopy && env.IPATENT_R2) {
    ctx?.waitUntil?.(
      env.IPATENT_R2.put(r2Key, documentHtml, { httpMetadata: { contentType: "text/html" } }).catch((err) => console.error("R2 put failed:", err.message))
    );
  }
  return json({
    submission_id: submissionId,
    title,
    sections,
    document_html: documentHtml,
    rag_sources: ragContext.map((r) => ({ title: r.title, score: r.score, section: r.section })),
    prior_art: priorArt,
    paragraphs: paragraphs.map((p) => ({ n: p.n, key: p.key, text: p.text })),
    support_map: supportMapData,
    mechanism: mechanism,
    mechanism_holes: mechanism ? mechanismHoles(mechanism) : [],
    attempts: sections.__attempts || [],
    saved: keepCopy,
    private_link: keepCopy ? CANONICAL_ORIGIN + "/d/" + submissionId : null,
    rate_limit: rateLimit
  });
}
__name(handleDraft, "handleDraft");
__name2(handleDraft, "handleDraft");
__name22(handleDraft, "handleDraft");
__name222(handleDraft, "handleDraft");
async function handleSearch(env, url) {
  const q = url.searchParams.get("q") || url.searchParams.get("query");
  if (!q || q.trim().length < 2) return json({ error: "Missing query parameter (q or query)" }, 400);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 20);
  const results = await searchDisclosures(env, q.trim(), limit);
  return json({ query: q.trim(), count: results.length, results });
}
__name(handleSearch, "handleSearch");
__name2(handleSearch, "handleSearch");
__name22(handleSearch, "handleSearch");
__name222(handleSearch, "handleSearch");
async function handleDisclosures(env, url) {
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const rows = await env.IPATENT_DB.prepare(
    "SELECT submission_id, title, inventor_name, technical_field, status, created_at FROM submissions ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
  ).bind(limit, offset).all();
  return json({ count: rows.results?.length || 0, offset, limit, disclosures: rows.results || [] });
}
__name(handleDisclosures, "handleDisclosures");
__name2(handleDisclosures, "handleDisclosures");
__name22(handleDisclosures, "handleDisclosures");
__name222(handleDisclosures, "handleDisclosures");
async function handleSubmission(env, id) {
  const row = await env.IPATENT_DB.prepare("SELECT submission_id, inventor_name, title, disclosure_text, document_html, status, technical_field, abstract, claims, summary, background, created_at FROM submissions WHERE submission_id = ?1" /* SUBMISSION-PII-1 (2026-10-01): no email, IP, user agent, country or session id on a public route */).bind(id).first();
  if (!row || row.title === "[private]") return json({ error: "Submission not found" }, 404);
  return json(row);
}
__name(handleSubmission, "handleSubmission");
__name2(handleSubmission, "handleSubmission");
__name22(handleSubmission, "handleSubmission");
__name222(handleSubmission, "handleSubmission");
// IPATENT-COST-PER-DRAFT-1 (agent_issues 1903, 2055): the measured model cost of a draft, from the metering ledger.
// Aggregates only (no text, no address). It reports cost; it sets no price: pricing is the owner's commercial decision.
var COST_DONE_MODEL = "(completed draft)";
var COST_NEURON_USD_PER_1000 = 0.011;
var COST_PRICE_SOURCE = "https://developers.cloudflare.com/workers-ai/platform/pricing/";
var COST_WINDOW_DAYS = 30;
async function handleCost(env) {
  const out = { ok: true, worker: "qnfo-ipatent", version: VERSION, window_days: COST_WINDOW_DAYS, neuron_usd_per_1000: COST_NEURON_USD_PER_1000, price_source: COST_PRICE_SOURCE,
    note: "Measured Workers AI cost of drafting, from qnfo-audit ai_call_counters. Embedding calls are not metered. This is a cost, not a price.",
    drafts_completed: 0, model_calls: 0, model_errors: 0, neurons: 0, usd: 0, cost_per_draft_usd: null, neurons_per_draft: null, seconds_per_draft: null, unmetered_calls: 0, by_purpose: [] };
  if (!env || !env.AUDIT) { out.ok = false; out.error = "the metering ledger is not bound"; return json(out, 503); }
  let rows;
  try {
    rows = (await env.AUDIT.prepare("SELECT purpose, model, SUM(calls) AS calls, SUM(errors) AS errors, SUM(in_chars) AS in_chars, SUM(ms) AS ms, SUM(in_tok) AS in_tok, SUM(out_tok) AS out_tok, SUM(neurons) AS neurons, MIN(day) AS first_day, MAX(day) AS last_day FROM ai_call_counters WHERE worker = 'qnfo-ipatent' AND day >= date('now', ?1) GROUP BY purpose, model ORDER BY purpose, model").bind("-" + (COST_WINDOW_DAYS - 1) + " days").all()).results || [];
  } catch (e) {
    console.error("cost read failed:", e && e.message || e);
    out.ok = false; out.error = "the metering ledger could not be read"; return json(out, 503);
  }
  const usdOf = (n) => Math.round(n * COST_NEURON_USD_PER_1000 / 1000 * 1e6) / 1e6;
  let doneMs = 0;
  for (const r of rows) {
    const calls = Number(r.calls) || 0, errors = Number(r.errors) || 0, neurons = Number(r.neurons) || 0;
    if (r.purpose === "draft-done") { out.drafts_completed += calls; doneMs += Number(r.ms) || 0; if (!out.first_day || r.first_day < out.first_day) out.first_day = r.first_day; continue; }
    out.model_calls += calls; out.model_errors += errors; out.neurons += neurons;
    // A call that answered but reported no usage cannot be priced; it is counted so the total is read as a lower bound.
    if (calls - errors > 0 && neurons === 0) out.unmetered_calls += calls - errors;
    out.by_purpose.push({ purpose: r.purpose, model: r.model, calls, errors, in_tok: Number(r.in_tok) || 0, out_tok: Number(r.out_tok) || 0, in_chars: Number(r.in_chars) || 0, ms: Number(r.ms) || 0, neurons: Math.round(neurons * 100) / 100, usd: usdOf(neurons), first_day: r.first_day, last_day: r.last_day });
  }
  out.neurons = Math.round(out.neurons * 100) / 100;
  out.usd = usdOf(out.neurons);
  if (out.drafts_completed > 0) {
    out.cost_per_draft_usd = Math.round(out.usd / out.drafts_completed * 1e6) / 1e6;
    out.neurons_per_draft = Math.round(out.neurons / out.drafts_completed * 100) / 100;
    out.seconds_per_draft = Math.round(doneMs / out.drafts_completed / 100) / 10;
  }
  return json(out);
}
async function handleStatus(env) {
  const [subCount, recent] = await Promise.all([
    env.IPATENT_DB.prepare("SELECT COUNT(*) as cnt FROM submissions").first(),
    Promise.resolve(null)
  ]);
  return json({
    status: "ok",
    worker: "qnfo-ipatent",
    version: VERSION,
    model: AI_DRAFT_MODELS[0],
    embed_model: AI_EMBED_MODEL,
    draft_models: AI_DRAFT_MODELS,
    stats: { total_submissions: subCount?.cnt || 0 },
    bindings: {
      d1: !!env.IPATENT_DB,
      r2: !!env.IPATENT_R2,
      vz: !!env.DISCLOSURES_VZ,
      ai: !!env.AI
    }
  });
}
__name(handleStatus, "handleStatus");
__name2(handleStatus, "handleStatus");
__name22(handleStatus, "handleStatus");
__name222(handleStatus, "handleStatus");
var FIELD_SUGGESTIONS = [
  "Quantum Computing & Information",
  "Cryptography & Post-Quantum Security",
  "Cryogenic & Semiconductor Electronics",
  "Energy-Efficient & Thermodynamic Computing",
  "Resonant / Analog Signal Processing",
  "Data Encoding & Compression",
  "Materials & Nanofabrication",
  "Topological Computation",
  "Neuromorphic & Neural Hardware",
  "Error Correction & Stabilization",
  "Measurement & Sensing Systems",
  "Control Systems & Feedback",
  "Software Methods & Simulation",
  "Networking & Secure Communication",
  "Power & Thermal Management"
];
var MESSY_FIELD_TOKENS = ["draft", "brutal", "cleanup", "folder", "misc", "uncategorized", "_"];
var FIELD_RULES = [
  ["Cryptography & Post-Quantum Security", /qkd|key distribution|bb84|quantum key|cryptograph|encrypt|decrypt|post-quantum|breach|security breach/i],
  ["Quantum Computing & Information", /quantum|qubit|qpu|coherence|entangl|superposition|qec|surface code|wave function|state vector|probabilistic states/i],
  ["Resonant / Analog Signal Processing", /harmonic|resonan|oscillat|waveform|spectral|aperiodic|carrier wave|field modulation|radio frequency|rf signal/i],
  ["Topological Computation", /topolog|braid|anyon/i],
  ["Neuromorphic & Neural Hardware", /neuromorph|neural|spiking|brain|synaptic/i],
  ["Cryogenic & Semiconductor Electronics", /cryo|semiconductor|cmos|nanos|fabricat|integrated circuit|substrate|10k-30k|millikelvin/i],
  ["Data Encoding & Compression", /compress|encoding|entropy cod|storage|bitstream|data format/i],
  ["Networking & Secure Communication", /communicat|transmission|wireless|network|modulat|signal transmission/i],
  ["Power & Thermal Management", /thermal|power|energy|heat|efficien/i],
  ["Measurement & Sensing Systems", /measure|sensor|sensing|detect/i],
  ["Control Systems & Feedback", /control|feedback|orchestrat|stabiliz/i],
  ["Error Correction & Stabilization", /error correction|error-correct|fault tolerant/i],
  ["Materials & Nanofabrication", /material|substrate|medium|lattice|nanoparticle|film|engineered medium/i],
  ["Software Methods & Simulation", /simulat|software|algorithm|framework|engine|computer-implemented|method and system|generative/i]
];
function cleanField(title, raw, bodyText) {
  const rl = String(raw || "").toLowerCase();
  const messy = !rl || MESSY_FIELD_TOKENS.some((m) => rl.indexOf(m) >= 0);
  if (!messy) return String(raw || "");
  const t = String(title || "") + " " + String(bodyText || "");
  for (const r of FIELD_RULES) {
    if (r[1].test(t)) return r[0];
  }
  return "Quantum Computing & Information";
}
__name(cleanField, "cleanField");
function decorateIdea(idea) {
  if (!idea || typeof idea !== "object") return idea;
  const clean = cleanField(String(idea.title || ""), String(idea.technical_field || ""), String(idea.description || ""));
  return Object.assign({}, idea, { field_clean: clean, technical_field: clean });
}
__name(decorateIdea, "decorateIdea");
var IDEA_META_CACHE = null;
function ideaMeta() {
  if (IDEA_META_CACHE) return IDEA_META_CACHE;
  IDEA_META_CACHE = (Array.isArray(IDEA_BANK) ? IDEA_BANK : []).map((d, i) => ({
    i,
    title: String(d && d.title || ""),
    technical_field: cleanField(String(d && d.title || ""), String(d && d.technical_field || ""), String(d && d.description || "")),
    field_clean: cleanField(String(d && d.title || ""), String(d && d.technical_field || ""), String(d && d.description || "")),
    focus: String(d && d.description || "").replace(/\s+/g, " ").slice(0, 160)
  })).filter((m) => m.title && m.title.length > 3);
  return IDEA_META_CACHE;
}
__name(ideaMeta, "ideaMeta");
function fieldPrefixes(field) {
  const f = String(field || "").trim().toLowerCase();
  if (!f) return FIELD_SUGGESTIONS.slice(0, 6);
  const out = FIELD_SUGGESTIONS.filter((x) => {
    const xl = x.toLowerCase();
    return xl.indexOf(f) === 0 || xl.split(" & ")[0].toLowerCase().indexOf(f) === 0 || xl.indexOf(f) > 0;
  });
  return out.slice(0, 6);
}
__name(fieldPrefixes, "fieldPrefixes");
async function handleSuggest(env, url) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 300);
  const field = (url.searchParams.get("field") || "").trim().slice(0, 80);
  const out = { q, field, policy: "ip-domain only; grounded in the iPATENT corpus; personal/ops actions are never suggested" };
  out.fields = fieldPrefixes(field);
  const meta = ideaMeta();
  const examples = [];
  if (meta.length) {
    const day = Math.floor(Date.now() / 864e5);
    const step = Math.max(1, Math.floor(meta.length / 4));
    for (let k = 0; k < 4 && k < meta.length; k++) examples.push(meta[(day + k * step) % meta.length]);
  }
  out.examples = examples;
  if (q.length >= 3) {
    const sim = await searchDisclosures(env, q, 5);
    out.similar = (sim || []).map((x) => ({
      title: x.title,
      section: x.section,
      technical_field: x.technical_field,
      field_clean: cleanField(String(x.title || ""), String(x.technical_field || ""), String(x.disclosure_text || "")),
      score: Math.round((Number(x.score) || 0) * 100) / 100,
      source_file: x.source_file,
      snippet: String(x.disclosure_text || "").replace(/\s+/g, " ").slice(0, 180)
    }));
  }
  return json(out);
}
__name(handleSuggest, "handleSuggest");
var BENCH_PROBE_URL = "https://patents.google.com/patent/US11000000B2/en";
// BENCH-SOURCE-PROBE-2 (3.9.6, #1779): a second keyless source, the USPTO's own Patent Public Search JSON API (the API behind
// ppubs.uspto.gov). A session read it verbatim on 2026-10-05: US 11,000,000 B2 gave an 853-character abstract, 3,804
// characters of claims and the "claims the benefit of U.S. Provisional Application Ser. No. 62/731,230" cross-reference,
// with no key (anonymous session token, then search, then the document sections). Google Patents answers a Worker 200 in
// some colos and 503 in others, so the probe now reports both. Same fixed patent, no user input reaches either request.
var PPUBS_API = "https://ppubs.uspto.gov/api/";
async function ppubsProbe() {
  var o = { source: "ppubs.uspto.gov (USPTO Patent Public Search API, no key)" };
  try {
    var hd = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (compatible; QNFO-iPatent-benchmark/1.0; +https://ipatent.qnfo.org/)" };
    var s = await fetch(PPUBS_API + "users/me/session", { method: "POST", headers: hd, body: "-1" });
    var tok = s.headers.get("X-Access-Token"), sj = await s.json().catch(function() { return null; });
    o.session_status = s.status;
    if (!tok || !sj || !sj.userCase) { o.error = "no anonymous session token"; return o; }
    hd["X-Access-Token"] = tok;
    var q = { start: 0, pageCount: 1, sort: "date_publ desc", docFamilyFiltering: "familyIdFiltering", searchType: 1, familyIdEnglishOnly: true, familyIdFirstPreferred: "US-PGPUB", familyIdSecondPreferred: "USPAT", familyIdThirdPreferred: "FPRS", showDocPerFamilyPref: "showEnglish", queryId: 0, tagDocSearch: false, query: { caseId: sj.userCase.caseId, hl_snippets: "2", op: "OR", q: "11000000.pn.", queryName: "11000000.pn.", highlights: "1", qt: "brs", spellCheck: false, viewName: "tile", plurals: true, britishEquivalents: true, databaseFilters: [{ databaseName: "USPAT", countryCodes: [] }], searchType: 1, ignorePersist: false, userEnteredQuery: "11000000.pn." } };
    var r = await fetch(PPUBS_API + "searches/searchWithBeFamily", { method: "POST", headers: hd, body: JSON.stringify(q) });
    var rj = await r.json().catch(function() { return null; }), d0 = rj && rj.patents && rj.patents[0];
    o.search_status = r.status;
    if (!d0 || !d0.guid) { o.error = "search returned no document"; return o; }
    var t = await fetch(PPUBS_API + "patents/highlightSections/" + encodeURIComponent(d0.guid) + "?queryId=" + encodeURIComponent(d0.queryId || rj.query && rj.query.id || 1) + "&source=" + encodeURIComponent(d0.type || "USPAT"), { method: "POST", headers: hd, body: '["all"]' });
    var tj = await t.json().catch(function() { return {}; });
    var txt = function(x) { return String(x || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); };
    o.status = t.status;
    o.abstract_chars = txt(tj.abstractHtml).length;
    o.claims_chars = txt(tj.claimsHtml).length;
    o.claims_found = o.claims_chars > 200;
    o.provisional_ref_found = /Provisional Application/i.test(txt(tj.backgroundTextHtml) + " " + txt(tj.briefHtml) + " " + txt(tj.descriptionHtml));
  } catch (e) { console.log("PPUBS_PROBE_ERROR " + String(e && e.message || e).slice(0, 200)); o.error = "probe failed (see worker log)"; }
  return o;
}
async function benchSourceProbe(request, ctx) {
  var cache = typeof caches !== "undefined" ? caches.default : null;
  var key = new Request("https://ipatent.qnfo.org/__bench-source-probe-v2");
  if (cache) { try { var hit = await cache.match(key); if (hit) return hit; } catch (e) { console.error(JSON.stringify({ worker: "qnfo-ipatent", where: "benchSourceProbe", error: String(e && e.message || e) })); } }
  var out = { source: BENCH_PROBE_URL, checked_at: new Date().toISOString() };
  try {
    var r = await fetch(BENCH_PROBE_URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; QNFO-iPatent-benchmark/1.0; +https://ipatent.qnfo.org/)", "Accept": "text/html" } });
    var h = await readTextCapped(r, 3e6);
    out.status = r.status; out.bytes = h.length;
    out.claims_found = /class="claim"|itemprop="claims"/.test(h);
    out.provisional_ref_found = /[Pp]rovisional/.test(h);
  } catch (e) { console.log("SOURCE_PROBE_ERROR " + String(e && e.message || e).slice(0, 200)); out.error = "fetch failed (see worker log)"; }
  out.ppubs = await ppubsProbe();
  out.keyless_text = !!((out.status === 200 && out.claims_found) || (out.ppubs.status === 200 && out.ppubs.claims_found));
  var res = new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
  if (cache && ctx && ctx.waitUntil) { try { ctx.waitUntil(cache.put(key, res.clone())); } catch (e) { console.error(JSON.stringify({ worker: "qnfo-ipatent", where: "benchSourceProbe", error: String(e && e.message || e) })); } }
  return res;
}
// BENCH-DATASET-1 (3.10.0, #1779 step 1): the benchmark's patent sample, built server-side from the keyless USPTO Patent
// Public Search API proven by BENCH-SOURCE-PROBE-2. Method (fixed, so anyone can rebuild the same sample):
//   - three fields by CPC subclass: G06N (machine learning and AI), A61B (diagnosis and surgery), H01M (batteries);
//   - granted US utility patents (USPAT) published 2025-01-01 to 2025-06-30, newest first, as the search returns them;
//   - a patent qualifies when its text cites a US provisional application (60/, 61/, 62/ or 63/ series) AND its own
//     application was filed within 366 days of the earliest related filing date, i.e. it claims the provisional directly
//     rather than through a continuation chain (what an AI-drafted provisional would be measured against);
//   - the first 10 qualifying patents per field are kept; hits are pre-filtered on their own dates, at most 15 search
//     pages of 20 and 40 documents are read per field.
// Stored once in R2 at benchmark/dataset.json with the query, the rule and verbatim abstract and claims text. GET answers
// the stored summary; POST builds it only when it is missing (a build lock stops concurrent builds), so the endpoint cannot
// be used to hammer the USPTO. No user input reaches a USPTO request. No model is called here: the drafting and scoring
// steps are separate; under BUDGET-SOFT-ROUTE-1 (owner directive 2026-10-06) a breached fleet_budget cap makes them use
// the cheapest capable model, it never makes them wait.
var BENCH_DATASET_KEY = "benchmark/dataset.json";
var BENCH_DATASET_LOCK = "benchmark/dataset.lock";
var BENCH_DATASET_PARTIAL = "benchmark/dataset.partial.json";
var BENCH_FIELDS = [{ key: "ml", cpc: "G06N", label: "machine learning and AI (CPC G06N)" }, { key: "medical", cpc: "A61B", label: "medical diagnosis and surgery (CPC A61B)" }, { key: "batteries", cpc: "H01M", label: "batteries and fuel cells (CPC H01M)" }];
var BENCH_WINDOW = { from: "20250101", to: "20250630" };
var BENCH_PER_FIELD = 10;
var BENCH_MAX_READ = 40;
var BENCH_MAX_PAGES = 15;
var BENCH_PROV_RX = /[Pp]rovisional (?:[Pp]atent )?[Aa]pplication(?:s)?,? (?:[Ss]er(?:ial)?\.? )?(?:[Nn]o\.? ?|[Nn]umber )?(6[0-3]\/\d{3},?\d{3})/;
var BENCH_ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
function benchText(x) {
  // One pass over the entities, so "&amp;lt;" decodes to the literal text "&lt;", never to "<" (CodeQL js/double-escaping, PR 627).
  return String(x || "").replace(/<[^>]+>/g, " ").replace(/&(nbsp|amp|lt|gt|quot|#39);/g, function(m, e) { return BENCH_ENTITIES[e]; }).replace(/\s+/g, " ").trim();
}
function benchDays(a, b) {
  var x = Date.parse(a), y = Date.parse(b);
  return isFinite(x) && isFinite(y) ? Math.round((x - y) / 864e5) : null;
}
// Pure: does one search hit plus its document text qualify, and what is kept. Exported for the offline suite.
function benchQualify(hit, doc) {
  var all = benchText(doc.backgroundTextHtml) + " " + benchText(doc.briefHtml) + " " + benchText(doc.descriptionHtml);
  var m = BENCH_PROV_RX.exec(all);
  if (!m) return { ok: false, why: "no provisional reference" };
  var filed = (hit.applicationFilingDate || [])[0] || null;
  var rel = (hit.relatedApplFilingDate || []).slice().sort()[0] || null;
  var gap = benchDays(filed, rel);
  if (gap === null || gap < 0 || gap > 366) return { ok: false, why: "not a direct claim to the provisional (filing gap " + gap + " days)" };
  var claims = benchText(doc.claimsHtml);
  if (claims.length < 200) return { ok: false, why: "claims text missing" };
  return { ok: true, row: { guid: hit.guid, title: hit.inventionTitle || null, published: String(hit.datePublished || "").slice(0, 10), filed: String(filed).slice(0, 10), provisional_filed: String(rel).slice(0, 10), provisional_no: m[1], filing_gap_days: gap, cpc: hit.cpcInventiveFlattened || null, abstract: benchText(doc.abstractHtml).slice(0, 4e3), claims: claims.slice(0, 6e4), claims_chars: claims.length, source_url: "https://ppubs.uspto.gov/pubwebapp/ (" + hit.guid + ")" } };
}
async function ppubsSession() {
  var hd = { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (compatible; QNFO-iPatent-benchmark/1.0; +https://ipatent.qnfo.org/)" };
  var s = await fetch(PPUBS_API + "users/me/session", { method: "POST", headers: hd, body: "-1" });
  var tok = s.headers.get("X-Access-Token"), sj = await s.json().catch(function() { return null; });
  if (!tok || !sj || !sj.userCase) throw new Error("ppubs session " + s.status);
  hd["X-Access-Token"] = tok;
  return { hd: hd, caseId: sj.userCase.caseId };
}
async function ppubsSearch(ss, q, start, n) {
  var body = { start: start, pageCount: n, sort: "date_publ desc", docFamilyFiltering: "familyIdFiltering", searchType: 1, familyIdEnglishOnly: true, familyIdFirstPreferred: "USPAT", familyIdSecondPreferred: "US-PGPUB", familyIdThirdPreferred: "FPRS", showDocPerFamilyPref: "showEnglish", queryId: 0, tagDocSearch: false, query: { caseId: ss.caseId, hl_snippets: "2", op: "OR", q: q, queryName: q, highlights: "1", qt: "brs", spellCheck: false, viewName: "tile", plurals: true, britishEquivalents: true, databaseFilters: [{ databaseName: "USPAT", countryCodes: [] }], searchType: 1, ignorePersist: false, userEnteredQuery: q } };
  var j = await ppubsPaced(PPUBS_API + "searches/searchWithBeFamily", { method: "POST", headers: ss.hd, body: JSON.stringify(body) }, "ppubs search");
  return { hits: j.patents || [], queryId: j.query && j.query.id };
}
// The USPTO answers 429 to back-to-back document reads (measured 2026-10-05), so reads are paced and a 429 backs off.
var BENCH_PACE_MS = 1200;
function benchSleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
async function ppubsPaced(url, init, what) {
  for (var i = 0; i < 4; i++) {
    var r = await fetch(url, init);
    if (r.status !== 429) {
      if (!r.ok) throw new Error(what + " " + r.status);
      return await r.json();
    }
    await benchSleep(BENCH_PACE_MS * 4 * (i + 1));
  }
  throw new Error(what + " 429 after retries");
}
async function ppubsDoc(ss, hit, queryId) {
  await benchSleep(BENCH_PACE_MS);
  return await ppubsPaced(PPUBS_API + "patents/highlightSections/" + encodeURIComponent(hit.guid) + "?queryId=" + encodeURIComponent(hit.queryId || queryId || 1) + "&source=" + encodeURIComponent(hit.type || "USPAT"), { method: "POST", headers: ss.hd, body: '["all"]' }, "ppubs document");
}
async function benchBuildField(f) {
  var ss = await ppubsSession();
  var q = f.cpc + '$.cpc. AND @pd>="' + BENCH_WINDOW.from + '"<="' + BENCH_WINDOW.to + '"';
  var kept = [], skipped = {}, start = 0, read = 0, pages = 0;
  while (kept.length < BENCH_PER_FIELD && read < BENCH_MAX_READ && pages < BENCH_MAX_PAGES) {
    var page = await ppubsSearch(ss, q, start, 20);
    if (!page.hits.length) break;
    pages++;
    for (var h of page.hits) {
      if (kept.length >= BENCH_PER_FIELD || read >= BENCH_MAX_READ) break;
      if (h.type && h.type !== "USPAT") continue;
      // Pre-filter on the search hit's own dates, before any document read: most granted patents in a window descend from
      // decade-old families (2026-10-05 live run: A61B kept 0 of 40 reads), so only a hit whose earliest related filing is
      // within 366 days of its own filing is read. The same rule is checked again on the document in benchQualify.
      var rel0 = (h.relatedApplFilingDate || []).slice().sort()[0];
      if (!rel0) { skipped["no related application"] = (skipped["no related application"] || 0) + 1; continue; }
      var g0 = benchDays((h.applicationFilingDate || [])[0], rel0);
      if (g0 === null || g0 < 0 || g0 > 366) { skipped["not a direct claim to the provisional"] = (skipped["not a direct claim to the provisional"] || 0) + 1; continue; }
      read++;
      var qv = benchQualify(h, await ppubsDoc(ss, h, page.queryId));
      if (qv.ok) kept.push(qv.row);
      else { var why = qv.why.replace(/ \(.*$/, ""); skipped[why] = (skipped[why] || 0) + 1; }
    }
    start += page.hits.length;
  }
  return { key: f.key, label: f.label, query: q, pages: pages, read: read, kept: kept.length, skipped: skipped, patents: kept };
}
function benchAssemble(fields) {
  var total = fields.reduce(function(a, x) { return a + x.kept; }, 0);
  return { schema: "ipatent-benchmark-dataset/v1", built_at: new Date().toISOString(), built_by: "qnfo-ipatent " + VERSION + " BENCH-DATASET-1", source: "USPTO Patent Public Search API (ppubs.uspto.gov/api), no key", window: BENCH_WINDOW, rule: "granted USPAT, CPC subclass per field, published in the window, newest first; kept when the text cites a US provisional (60-63 series) and the application was filed within 366 days of the earliest related filing; first " + BENCH_PER_FIELD + " per field; search hits are pre-filtered on their own filing dates, at most " + BENCH_MAX_PAGES + " search pages of 20 and " + BENCH_MAX_READ + " documents read per field", documents_read: fields.reduce(function(a, x) { return a + x.read; }, 0), patents_total: total, complete: total === BENCH_PER_FIELD * BENCH_FIELDS.length, fields: fields };
}
function benchSummary(ds) {
  return { schema: ds.schema, built_at: ds.built_at, built_by: ds.built_by, source: ds.source, window: ds.window, rule: ds.rule, documents_read: ds.documents_read, patents_total: ds.patents_total, complete: ds.complete, fields: (ds.fields || []).map(function(f) { return { key: f.key, label: f.label, query: f.query, read: f.read, kept: f.kept, skipped: f.skipped, patents: (f.patents || []).map(function(p) { return { guid: p.guid, title: p.title, published: p.published, provisional_no: p.provisional_no, provisional_filed: p.provisional_filed, filed: p.filed, filing_gap_days: p.filing_gap_days, claims_chars: p.claims_chars }; }) }; }), r2_key: BENCH_DATASET_KEY };
}
async function benchDataset(request, env) {
  var jh = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!env.IPATENT_R2) return new Response(JSON.stringify({ error: "no R2 binding" }), { status: 503, headers: jh });
  var have = await env.IPATENT_R2.get(BENCH_DATASET_KEY);
  if (have) {
    var ds = await have.json();
    return new Response(JSON.stringify(Object.assign({ status: "stored" }, benchSummary(ds))), { headers: jh });
  }
  if (request.method !== "POST") return new Response(JSON.stringify({ status: "missing", how: "POST /api/benchmark/dataset builds it one field per call (three calls, up to 40 paced keyless USPTO reads each); once complete, calls return the stored sample" }), { status: 404, headers: jh });
  var lock = await env.IPATENT_R2.get(BENCH_DATASET_LOCK);
  if (lock) {
    var at = Date.parse(await lock.text());
    if (isFinite(at) && Date.now() - at < 15 * 6e4) return new Response(JSON.stringify({ status: "building", since: new Date(at).toISOString() }), { status: 409, headers: jh });
  }
  await env.IPATENT_R2.put(BENCH_DATASET_LOCK, new Date().toISOString());
  try {
    // One field per call (each is up to 40 paced USPTO reads, about a minute); progress lives in R2 between calls.
    var pobj = await env.IPATENT_R2.get(BENCH_DATASET_PARTIAL);
    var done = pobj ? (await pobj.json()).fields || [] : [];
    var next = BENCH_FIELDS.find(function(f) { return !done.some(function(d) { return d.key === f.key; }); });
    if (next) {
      done.push(await benchBuildField(next));
      await env.IPATENT_R2.put(BENCH_DATASET_PARTIAL, JSON.stringify({ fields: done }));
    }
    if (done.length < BENCH_FIELDS.length) return new Response(JSON.stringify({ status: "partial", fields_done: done.map(function(d) { return { key: d.key, kept: d.kept, read: d.read }; }), next: "POST again to build the next field" }), { status: 202, headers: jh });
    var built = benchAssemble(done);
    if (built.patents_total > 0) await env.IPATENT_R2.put(BENCH_DATASET_KEY, JSON.stringify(built), { httpMetadata: { contentType: "application/json" } });
    await env.IPATENT_R2.delete(BENCH_DATASET_PARTIAL);
    return new Response(JSON.stringify(Object.assign({ status: built.patents_total > 0 ? "built" : "empty" }, benchSummary(built))), { status: built.patents_total > 0 ? 201 : 502, headers: jh });
  } catch (e) {
    console.log("BENCH_DATASET_ERROR " + String(e && e.message || e).slice(0, 200));
    return new Response(JSON.stringify({ status: "failed", error: "the USPTO source failed mid-field (see worker log); fields already built are kept, POST again to resume" }), { status: 502, headers: jh });
  } finally {
    try { await env.IPATENT_R2.delete(BENCH_DATASET_LOCK); } catch (e) { console.error(JSON.stringify({ worker: "qnfo-ipatent", where: "benchDataset", error: String(e && e.message || e) })); }
  }
}
// GUIDE-PAGES-1 (3.9.0): the iPatent guide family as data, rendered by one template. Attribution, dates, licence, share
// card, canonical and structured data come from renderGuidePage, never from a page entry, so an automated edit cannot
// invent an author, an ORCID, a date or a copyright line (2026-10-02: a code-agent draft did all four and replaced
// /guide; it was stopped before merge). Every legal statement cites its source; when unsure, a page says less.
// routes.test.mjs (deploy-gate) fails CI if any page here, /guide, /example or the sitemap stops answering 200, or if a
// page carries any ORCID but the author's.
var GUIDE_AUTHOR = { name: "Rowan Brad Quni-Gudzinas", orcid: "0009-0002-4317-5604" };
var GUIDE_PAGES = [
  { slug: "before-you-publish", title: "Before you publish: grace periods, pitches and preprints", updated: "2026-10-02",
    description: "Why a blog post, talk, preprint or pitch can cost you a patent: the US one-year grace period, Europe's absolute novelty rule, and what to file first.",
    sections: [
      ["The short answer", "<p>File first, then talk. A provisional application costs little and fixes a filing date; anything you make public before that date can be used against you, and outside the US it usually cannot be undone.</p>"],
      ["The United States: a one-year grace period, with limits", "<p>Your own public disclosure made one year or less before your effective filing date is not prior art against you (35 U.S.C. 102(b)(1)(A)). Relying on it is still risky: you must be able to prove the disclosure was yours, a third party may build on what you published and file first, and the grace period does not carry over to most other countries.</p>"],
      ["Europe and most other countries: absolute novelty", "<p>Under the European Patent Convention, anything made available to the public before the filing date is prior art (Art. 54 EPC), including your own talk, preprint, demo or post. The exceptions are narrow: an evident abuse against you, or display at an officially recognised international exhibition, each within six months (Art. 55 EPC). A few countries offer limited grace periods with conditions; check before relying on one.</p>"],
      ["What counts as making it public", "<ul><li>a preprint, paper, thesis, blog post or social post;</li><li>a conference talk, poster or public demo;</li><li>a crowdfunding page, a product listing or a sale. In the US an offer for sale can bar a patent even when the sale is confidential (<i>Helsinn v. Teva</i>, U.S. 2019).</li></ul><p>A pitch to a small group under a written confidentiality agreement is generally not a public disclosure. A pitch deck sent around freely, or posted, may be.</p>"],
      ["What to file first", "<p>A provisional that describes the invention fully, with drawings, before any disclosure. It secures priority only for what it describes (35 U.S.C. 112(a)), so a thin one written in a hurry protects little. Within twelve months, file the nonprovisional or an international (PCT) application that claims its benefit.</p>"]
    ] },
  { slug: "claims-in-a-provisional", title: "Claims in a provisional: optional, and still useful", updated: "2026-10-02",
    description: "A US provisional needs no claims. Why drafting some anyway helps, and why what the description supports matters more than the claims themselves.",
    sections: [
      ["Not required", "<p>A provisional application does not need claims (35 U.S.C. 111(b)(2)). It is never examined, so nothing in it is allowed or rejected.</p>"],
      ["What actually secures the date", "<p>A later claim gets the provisional's filing date only if the provisional describes and enables what that claim covers (35 U.S.C. 119(e)(1), which applies the requirements of 112(a); see <i>New Railhead Mfg. v. Vermeer Mfg.</i>, Fed. Cir. 2002). The description is what counts, not the claims.</p>"],
      ["Why draft claims anyway", "<p>A draft claim set is a checklist. Each element of each claim names something the description must explain well enough for a skilled person to make and use it. If you cannot point to the paragraph that supports an element, the provisional does not yet protect it.</p><p>That is what iPatent's support map does: it matches every claim element to the numbered paragraph that shares its terms, and flags any element, or any number in a claim, that the description never supports. <a href=\"/example\">See it catch an invented torque range and material.</a></p>"],
      ["Write broad and narrow", "<p>Describe the general idea and every variant you may later want to claim: other materials, ranges, configurations and orders of steps. A variant that is not described cannot be added later with the original date.</p>"]
    ] },
  { slug: "drawings", title: "Drawings in a provisional patent application", updated: "2026-10-02",
    description: "When a provisional needs drawings, what each figure should show, and how reference numerals tie figures to the description.",
    sections: [
      ["When drawings are required", "<p>An application must include drawings wherever they are necessary to understand the invention (35 U.S.C. 113). For a mechanical or electrical invention that is almost always. A method can be shown as a flowchart.</p>"],
      ["What each figure should show", "<ul><li>the whole invention, and each part that matters, from the views a reader needs (perspective, side, section, exploded);</li><li>every embodiment and alternative you describe, not only the preferred one;</li><li>for methods and software, a flowchart of the steps and a block diagram of the components.</li></ul>"],
      ["Reference numerals", "<p>Give each part a number and use the same number for the same part in every figure and in the text (\"the pivot pin (14)\"). Add a short description of each figure (\"FIG. 2 is a side view of the hinge folded flat\"). This is how the drawings support the written description.</p>"],
      ["Format", "<p>Use clear black-and-white line drawings. Photographs are accepted only in narrow cases, where they are the only practical way to show the invention (37 CFR 1.84(b)). The formal drawing rules (37 CFR 1.84) govern the nonprovisional; preparing the provisional's figures to that standard now saves rework later.</p>"]
    ] },
  { slug: "provisional-vs-nonprovisional", title: "Provisional vs nonprovisional patent applications", updated: "2026-10-02",
    description: "What each US application does, what it costs, the 12-month link between them, and which to file first.",
    sections: [
      ["Provisional", "<ul><li>gives an effective filing date for what it describes;</li><li>needs no claims, oath or declaration, and is never examined (35 U.S.C. 111(b));</li><li>lapses twelve months after filing and cannot itself become a patent;</li><li>filing fee $325, $130 for small entities, $65 for micro entities (USPTO fee schedule since 19 January 2025).</li></ul>"],
      ["Nonprovisional", "<ul><li>is examined and can become a patent;</li><li>needs claims, a full specification, drawings where necessary and an inventor's oath or declaration (35 U.S.C. 111(a), 115);</li><li>costs several times as much in USPTO fees (filing, search and examination), before any attorney's fees: see the <a href=\"https://www.uspto.gov/learning-and-resources/fees-and-payment/uspto-fee-schedule\" rel=\"noopener\">USPTO fee schedule</a>.</li></ul>"],
      ["The link between them", "<p>To keep the provisional's date, file a nonprovisional (or an international PCT application) that claims its benefit within twelve months (35 U.S.C. 119(e)). If that deadline is missed unintentionally, the USPTO can restore the right of priority on a petition filed within fourteen months (37 CFR 1.78(b)). Plan on twelve.</p>"],
      ["Which to file first", "<p>A provisional, when you need a date quickly, are still developing the invention, or need time to judge its commercial value, provided it describes the invention fully. File a nonprovisional directly when the invention is settled and you want examination to start.</p>"]
    ] },
  { slug: "file-a-us-provisional", title: "How to file a US provisional patent application yourself", updated: "2026-10-05",
    description: "The happy path from a finished description to a USPTO filing date: what to upload, what it costs, the 12-month deadline, and what a US filing does and does not secure in Europe.",
    sections: [
      ["What you need before you start", "<ul><li>a written description that explains the invention well enough for a skilled person to make and use it (35 U.S.C. 112(a)); it is the only thing the filing date protects;</li><li>drawings wherever they help a reader understand the invention (35 U.S.C. 113);</li><li>the names and residences of every inventor;</li><li>a cover sheet identifying the filing as a provisional application: USPTO form PTO/SB/16, or an application data sheet (37 CFR 1.51(c)(1), 1.76).</li></ul><p>Claims, an oath or declaration and an information disclosure statement are not required for a provisional (35 U.S.C. 111(b)(2); see <a href=\"/guide/claims-in-a-provisional\">claims in a provisional</a>).</p>"],
      ["The happy path, step by step", "<ol><li><b>Create a USPTO.gov account</b> and open Patent Center, the USPTO's electronic filing system. The USPTO may ask you to verify your identity before you can file; allow a few days for that the first time.</li><li><b>Start a new provisional utility application</b> and upload the cover sheet, the description and the drawings as separate documents.</li><li><b>Choose your entity status.</b> Small entity: generally an individual, a company with fewer than 500 employees, a university or a non-profit that has not licensed the invention to a large entity (37 CFR 1.27). Micro entity: a small entity that also meets an income limit and is named on no more than four earlier applications, not counting provisionals (37 CFR 1.29). Claiming a status you do not qualify for can make a later patent unenforceable, so check before you tick the box.</li><li><b>Pay the filing fee</b>: $325, $130 for a small entity, $65 for a micro entity (USPTO fee schedule since 19 January 2025, 37 CFR 1.16(d)). A description and drawings longer than 100 sheets add an application size fee (37 CFR 1.16(s)).</li><li><b>Keep the electronic acknowledgement receipt.</b> It shows your application number and the date of receipt, which is your filing date; the formal filing receipt follows by post or in Patent Center.</li><li><b>Put the 12-month deadline in your calendar now.</b> The provisional lapses twelve months after filing and cannot be revived (35 U.S.C. 111(b)(5)); the nonprovisional or PCT application that claims its date must be filed within those twelve months (35 U.S.C. 119(e)). Only an unintentional miss can be repaired, by a petition to restore the right of priority within fourteen months (37 CFR 1.78(b)), so plan on twelve; see <a href=\"/guide/provisional-vs-nonprovisional\">provisional vs nonprovisional</a> for what to file before then.</li></ol><p>From the filing date you may describe the invention as \"patent pending\" for what the provisional describes.</p>"],
      ["What a US provisional secures outside the US", "<p>A US provisional is a regular first filing under the Paris Convention (Art. 4). A European patent application or an international (PCT) application filed within twelve months can claim its date as a priority date (Art. 87 EPC), and the priority date then counts as the filing date when novelty is judged (Art. 89 EPC). So a talk, preprint or sale <i>after</i> the provisional's date does not destroy novelty in Europe for what the provisional describes.</p><p>Four limits matter:</p><ul><li>It covers only what the provisional discloses. The European Patent Office allows priority only for subject matter that a skilled person can derive directly and unambiguously from the earlier filing (Enlarged Board of Appeal, G 2/98). A thin provisional gives a thin priority.</li><li>It does nothing for a disclosure made <i>before</i> its date: Europe has no general grace period (Art. 54, 55 EPC; see <a href=\"/guide/before-you-publish\">before you publish</a>).</li><li>It protects nothing abroad by itself. The European or PCT application must be filed, in your name or your successor's, before the twelve months run out.</li><li>Some countries require their residents to file at home first or to obtain clearance before filing abroad, for example the United Kingdom for inventions in certain sensitive fields (Patents Act 1977, s. 23). Check your own country's rule before filing in the US first.</li></ul>"],
      ["When to pay for help", "<p>A provisional you file yourself secures a date for what it describes, and nothing more. Before you rely on it for an investment, a public launch or a European filing, have a registered patent attorney or agent check that the description supports everything you will want to claim. In the US, only a registered practitioner or the inventor may prepare and file an application (37 CFR 11.5(b)).</p>"]
    ] },
  { slug: "what-is-a-provisional-patent", title: "What is a provisional patent application?", updated: "2026-10-06",
    description: "A US provisional patent application in plain words: what it secures, what it costs, what it does not do, and when filing one makes sense.",
    sections: [
      ["The short answer", "<p>A provisional patent application is a short, informal US filing that fixes a filing date for an invention. It is never examined and never becomes a patent by itself. Within twelve months you file a regular (nonprovisional) application, or an international one, that claims its date (35 U.S.C. 111(b), 119(e)).</p>"],
      ["What it gives you", "<ul><li>a filing date for everything the provisional describes, so a later disclosure, sale or competing filing does not count against what it covers (35 U.S.C. 119(e)(1));</li><li>the right to describe the invention as \"patent pending\";</li><li>twelve months to test the market, raise money or improve the invention before paying for a full application;</li><li>a priority date that a European or international (PCT) application filed within twelve months can claim (Paris Convention, Art. 4; Art. 87 EPC). See <a href=\"/guide/file-a-us-provisional\">how to file one</a>.</li></ul>"],
      ["What it does not do", "<ul><li>It protects only what it describes. A later claim gets the provisional's date only if the provisional describes and enables it (35 U.S.C. 119(e)(1), applying 112(a)). A thin provisional gives a thin date.</li><li>It cannot be extended: twelve months after filing it lapses (35 U.S.C. 111(b)(5)).</li><li>It does not stop anyone from copying the invention. Only an issued patent can be enforced.</li><li>It does not help against a disclosure made <i>before</i> its filing date outside the US grace period (see <a href=\"/guide/before-you-publish\">before you publish</a>).</li></ul>"],
      ["What it needs", "<p>A written description and drawings that let a skilled person make and use the invention, the inventors' names and a cover sheet; claims, an oath and a formal format are not required (35 U.S.C. 111(b); 37 CFR 1.51(c)). The USPTO filing fee is $325, $130 for a small entity and $65 for a micro entity (37 CFR 1.16(d), fee schedule since 19 January 2025). See <a href=\"/guide/provisional-patent-cost\">what a provisional costs</a>.</p>"],
      ["When filing one makes sense", "<p>Before you show the invention publicly, pitch it outside a confidentiality agreement, or offer it for sale, and when you are still improving it or need time to judge whether a full application is worth its cost. <a href=\"/\">iPatent</a> drafts the description, flags which of your claims the description does not yet support, and lets you print it for filing or for a practitioner's review.</p>"]
    ] },
  { slug: "provisional-patent-cost", title: "How much does a provisional patent application cost?", updated: "2026-10-06",
    description: "USPTO fees for a US provisional ($65 to $325), what attorneys and agents typically charge to prepare one, and what filing it yourself costs.",
    sections: [
      ["USPTO fees", "<ul><li>Filing fee: $325, or $130 for a small entity, or $65 for a micro entity (37 CFR 1.16(d); USPTO fee schedule since 19 January 2025).</li><li>Application size fee only if the description and drawings exceed 100 sheets (37 CFR 1.16(s)).</li><li>No search or examination fee: a provisional is never examined.</li></ul><p>Small entity covers most individuals, small companies and universities (37 CFR 1.27); micro entity adds an income limit and a cap of four earlier applications, not counting provisionals (37 CFR 1.29). Claiming a status you do not qualify for can make a later patent unenforceable.</p>"],
      ["Professional preparation", "<p>Published ranges as of September 2026 (<a href=\"https://www.upcounsel.com/provisional-patent-cost\" rel=\"noopener\">UpCounsel</a>): a limited review of an inventor's own draft often costs $500 to $1,500; attorney preparation often $1,500 to $3,500 or more, and detailed applications can exceed $3,000 to $5,000; professional drawings often $300 to $500; a prior-art search often $1,000 to $3,000. Some firms quote flat fees in the same range, for example $3,600 for a provisional (<a href=\"https://patentext.com/blog/a-complete-list-of-ai-patent-tools\" rel=\"noopener\">Patentext</a>). These are typical published prices, not quotes.</p>"],
      ["Filing it yourself", "<p>An inventor may prepare and file a provisional without a practitioner; the cost is the USPTO fee plus your time (<a href=\"/guide/file-a-us-provisional\">step-by-step guide</a>). The risk is not the paperwork, which the USPTO keeps simple, but a description too thin to support the claims you will want later (35 U.S.C. 119(e)(1), 112(a)).</p><p><a href=\"/\">iPatent</a> drafts the description for free and checks every draft claim against it, so you see what is still unsupported before you file. A sensible middle path: draft with iPatent, then pay a registered practitioner only for a review.</p>"],
      ["What comes after", "<p>The nonprovisional application, filed within twelve months, costs considerably more in USPTO fees (filing, search and examination) and in professional fees; see the <a href=\"https://www.uspto.gov/learning-and-resources/fees-and-payment/uspto-fee-schedule\" rel=\"noopener\">USPTO fee schedule</a> and <a href=\"/guide/provisional-vs-nonprovisional\">provisional vs nonprovisional</a>.</p>"]
    ] },
  { slug: "provisional-patent-for-software", title: "Provisional patents for software and AI inventions", updated: "2026-10-06",
    description: "How to describe a software or AI invention in a US provisional so it can support eligible claims: the technical improvement, the algorithm, the data, and who counts as the inventor.",
    sections: [
      ["The eligibility question", "<p>Software claims fail in the US when they are directed to an abstract idea without an inventive concept (<i>Alice Corp. v. CLS Bank</i>, 573 U.S. 208 (2014)). Claims that improve how a computer or technical system works have been held eligible (<i>Enfish v. Microsoft</i>, Fed. Cir. 2016). A provisional cannot argue eligibility for you, but it must describe the technical improvement, or no later claim can rely on it.</p>"],
      ["What to describe", "<ul><li>the technical problem and how your approach changes what the system does: speed, memory, accuracy, energy, security;</li><li>the architecture: components, data flow and interfaces, with a block diagram;</li><li>the algorithm itself, step by step, with a flowchart. A claim written as a function (\"means for ranking\") is limited to the structure the description discloses, and for software that structure is the algorithm (35 U.S.C. 112(f); <i>Williamson v. Citrix</i>, Fed. Cir. 2015);</li><li>variants and alternatives you may want to claim later: other models, data sources, thresholds, orders of steps.</li></ul>"],
      ["AI and machine-learning inventions", "<ul><li>describe the inputs, the outputs, the model type and how it is trained, what data it learns from and how that data is prepared, and how the trained model is used;</li><li>give concrete parameter ranges you actually used rather than invented ones (see <a href=\"/example\">what an AI draft invents</a>);</li><li>only natural persons can be named as inventors (<i>Thaler v. Vidal</i>, Fed. Cir. 2022). A person who used AI is an inventor if they contributed significantly to the conception of each claimed invention (USPTO inventorship guidance for AI-assisted inventions, February 2024).</li></ul>"],
      ["Drafting with iPatent", "<p>Using a drafting tool does not make the tool an inventor: inventorship turns on who conceived the invention, not on who typed the description. <a href=\"/\">iPatent</a> structures the description and maps every draft claim element to the paragraph that supports it, which is where software provisionals most often fall short. Have a registered practitioner review a software provisional before you rely on it.</p>"]
    ] },
  // GUIDE-PAGES-APPEND: keep this line unchanged; a new page is one object inserted above it, with sources for every legal statement.
];
function renderGuidePage(page) {
  const esc = escapeHtml;
  const url = CANONICAL_ORIGIN + "/guide/" + page.slug;
  const ld = { "@context": "https://schema.org", "@type": "Article", headline: page.title, url: url, dateModified: page.updated, inLanguage: "en",
    author: { "@type": "Person", name: GUIDE_AUTHOR.name, sameAs: ["https://orcid.org/" + GUIDE_AUTHOR.orcid] },
    publisher: { "@type": "Organization", name: "QNFO", url: "https://qnfo.org" }, isPartOf: { "@type": "WebSite", name: "iPatent", url: CANONICAL_ORIGIN + "/" } };
  const others = GUIDE_PAGES.filter((p) => p.slug !== page.slug).map((p) => '<li><a href="/guide/' + p.slug + '">' + esc(p.title) + "</a></li>").join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(page.title)} \u00b7 iPatent</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${url}">
<meta name="author" content="${esc(GUIDE_AUTHOR.name)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="QNFO">
<meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${CANONICAL_ORIGIN}/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Source+Serif+4:opsz,wght@8..60,400..700&display=swap" rel="stylesheet">
<style>
  :root{--paper:#eef1f4;--ink:#131c28;--ink-soft:#4a5666;--green:#1d3fc4;--amber:#9a5b00;--line:#c9d1da;--white:#ffffff}
  *{box-sizing:border-box} body{margin:0;font-family:'Source Serif 4',Georgia,'Times New Roman',serif;background:var(--paper);color:var(--ink);line-height:1.7}
  .wrap{max-width:740px;margin:0 auto;padding:0 18px 60px} header{display:flex;justify-content:space-between;gap:10px;padding:20px 0;border-bottom:1px solid var(--line);font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px}
  a{color:var(--green)} h1{font-family:'Archivo',system-ui,sans-serif;font-stretch:110%;letter-spacing:-.02em;font-size:clamp(28px,6vw,40px);line-height:1.1;margin:36px 0 12px} h2{font-size:22px;margin:34px 0 6px}
  .lede{font-size:18px;color:var(--ink-soft)} li{margin:6px 0} .mono{font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:var(--ink-soft)}
  .cta{display:inline-block;margin:10px 10px 0 0;background:var(--green);color:var(--white);text-decoration:none;padding:12px 18px;font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px}
  footer{border-top:1px solid var(--line);margin-top:48px;padding-top:16px}
</style>
</head>
<body><div class="wrap">
<header><a href="/">iPatent \u00b7 ipatent.qnfo.org</a><span>GUIDE \u00b7 UPDATED ${esc(page.updated)}</span></header>
<h1>${esc(page.title)}</h1>
<p class="lede">${esc(page.description)}</p>
${page.sections.map(([h, body]) => "<h2>" + esc(h) + "</h2>" + body).join("\n")}
<p><a class="cta" href="/#draft">Draft a disclosure, free</a><a class="cta" style="background:var(--white);color:var(--green);border:1px solid var(--green)" href="/example">See a real run</a></p>
<h2>More guides</h2><ul><li><a href="/guide">What a provisional protects, and how to draft one</a></li>${others}</ul>
<footer><p class="mono">By ${esc(GUIDE_AUTHOR.name)} (<a href="https://orcid.org/${GUIDE_AUTHOR.orcid}">ORCID</a>) at <a href="https://qnfo.org">QNFO</a>. General information about US law and USPTO practice as of ${esc(page.updated)}, not legal advice: have a registered patent attorney or agent review your filing. Licensed under <a href="https://qnfo.org/legal">QNFO-ULA</a>. <a href="https://qnfo.org/work-with-me?utm_source=ipatent&amp;utm_medium=referral&amp;utm_campaign=ipatent-guide">Work with me</a> \u00b7 <a href="/#subscribe">Get the benchmark results</a></p>
<p class="mono">Share: ${shareLinks(url + "?utm_source=share&utm_medium=social&utm_campaign=ipatent-guide", page.title)}</p></footer>
</div>${fleetCtlLink(url)}</body></html>`;
}
__name(renderGuidePage, "renderGuidePage");

var GUIDE_UPDATED = "2026-10-02";
// TURNSTILE-EDGE-1 (3.20.0, BP26-EDGE-SECURITY-1): the drafting form and both subscribe forms carry a Turnstile widget; handleDraft and handleSubscribe verify its token (fail-open only while TURNSTILE_SECRET is unbound).
// BEGIN TURNSTILE-EDGE-1
var TURNSTILE_SITEKEY_DEFAULT = "0x4AAAAAAFpf2WdSG4-h5mu_";
var TURNSTILE_SCRIPT = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';
function turnstileWidget(env, action) {
  var key = (env && env.TURNSTILE_SITEKEY) || TURNSTILE_SITEKEY_DEFAULT;
  return '<div class="cf-turnstile" data-sitekey="' + key + '" data-action="' + String(action || "form").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) + '" data-appearance="interaction-only" data-theme="auto"></div>';
}
async function turnstileVerify(env, token, ip, action) {
  if (!env || !env.TURNSTILE_SECRET) return { ok: true, skipped: true, reason: "no-secret" };
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return { ok: false, reason: "missing-token" };
  try {
    var body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip) body.set("remoteip", ip);
    var r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: body, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, reason: "siteverify-" + r.status };
    var j = await r.json();
    if (!j || j.success !== true) return { ok: false, reason: "rejected:" + String((j && j["error-codes"]) || "").slice(0, 80) };
    if (action && j.action && j.action !== action) return { ok: false, reason: "action-mismatch" };
    return { ok: true, reason: "verified" };
  } catch (e) {
    return { ok: false, reason: "siteverify-error" };
  }
}
// END TURNSTILE-EDGE-1
// BEGIN TURNSTILE-SELFTEST-1
// TURNSTILE-SELFTEST-1 (agent_issues 1000681-1000683, pillar security): after TURNSTILE_SECRET was set on three workers nothing could show the
// new value works, because Cloudflare answers a wrong secret and a wrong visitor token with the same 403 to the visitor. siteverify itself tells
// them apart: a valid secret with a dummy token answers invalid-input-response, a wrong secret answers invalid-input-secret. At most once an hour
// this posts the bound secret with a dummy token and records the verdict as one cloud_ops_events row (kind turnstile-selftest, job = the worker,
// id = worker + hour, so a repeat in the same hour is a no-op). The secret is never logged or stored; nothing runs while TURNSTILE_SECRET is unbound.
var TURNSTILE_SELFTEST_WORKER = "qnfo-ipatent";
var turnstileSelfTestHour = "";
async function turnstileSelfTest(env) {
  var db = env && (env.AUDIT || env.QNFO_AUDIT);
  if (!env || !env.TURNSTILE_SECRET || !db) return { ran: false, reason: "no-secret-or-db" };
  var now = new Date(), hour = now.toISOString().slice(0, 13);
  if (turnstileSelfTestHour === hour) return { ran: false, reason: "done-this-hour" };
  turnstileSelfTestHour = hour;
  var id = "turnstile-selftest-" + TURNSTILE_SELFTEST_WORKER + "-" + hour;
  try {
    var seen = await db.prepare("SELECT 1 AS x FROM cloud_ops_events WHERE id = ?1").bind(id).first();
    if (seen) return { ran: false, reason: "done-this-hour" };
    var body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: "turnstile-selftest-dummy-token" });
    var r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: body, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { turnstileSelfTestHour = ""; return { ran: true, recorded: false, reason: "siteverify-" + r.status }; }
    var j = await r.json();
    var codes = ((j && j["error-codes"]) || []).map(String);
    var wrong = codes.indexOf("invalid-input-secret") >= 0 || codes.indexOf("missing-input-secret") >= 0;
    var testing = !!(j && j.metadata && j.metadata.result_with_testing_key);
    var accepted = !wrong && !testing && codes.indexOf("invalid-input-response") >= 0;
    var verdict = accepted ? "accepted" : wrong ? "rejected" : testing ? "testing-key" : "unknown";
    var text = "turnstile siteverify self-test (" + TURNSTILE_SELFTEST_WORKER + "): secret " + verdict + (accepted ? " by Cloudflare" : "") + " [" + codes.join(",").slice(0, 80) + "]";
    await db.prepare("INSERT OR IGNORE INTO cloud_ops_events (id, ts, kind, text, meta, job, status) VALUES (?1, ?2, 'turnstile-selftest', ?3, ?4, ?5, ?6)")
      .bind(id, now.toISOString(), text, JSON.stringify({ worker: TURNSTILE_SELFTEST_WORKER, secret: verdict, codes: codes.slice(0, 4), source: "selftest" }), TURNSTILE_SELFTEST_WORKER, accepted ? "ok" : "error").run();
    return { ran: true, recorded: true, verdict: verdict };
  } catch (e) {
    turnstileSelfTestHour = "";
    console.error(JSON.stringify({ worker: TURNSTILE_SELFTEST_WORKER, where: "turnstileSelfTest", error: String((e && e.message) || e).slice(0, 160) }));
    return { ran: true, recorded: false, error: "caught" };
  }
}
// END TURNSTILE-SELFTEST-1
var GUIDE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Provisional patent applications: what they protect and how to draft one \xB7 iPatent</title>
<meta name="description" content="A plain-language guide to US provisional patent applications: what a provisional protects, what to put in it, drawings, fees, the 12-month deadline, and why you should not publish before filing.">
<link rel="canonical" href="https://ipatent.qnfo.org/guide">
<meta name="author" content="Rowan Brad Quni-Gudzinas">
<meta property="og:type" content="article">
<meta property="og:site_name" content="QNFO">
<meta property="og:title" content="Provisional patent applications: what they protect and how to draft one">
<meta property="og:description" content="A provisional secures a filing date only for what it describes. A plain-language guide for inventors.">
<meta property="og:url" content="https://ipatent.qnfo.org/guide">
<meta property="og:image" content="https://ipatent.qnfo.org/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Provisional patent applications: what they protect and how to draft one","url":"https://ipatent.qnfo.org/guide","dateModified":"2026-10-02","inLanguage":"en","author":{"@type":"Person","name":"Rowan Brad Quni-Gudzinas","sameAs":["https://orcid.org/0009-0002-4317-5604"]},"publisher":{"@type":"Organization","name":"QNFO","url":"https://qnfo.org"},"isPartOf":{"@type":"WebSite","name":"iPatent","url":"https://ipatent.qnfo.org/"}}<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Source+Serif+4:opsz,wght@8..60,400..700&display=swap" rel="stylesheet">
<style>
  :root{--paper:#eef1f4;--ink:#131c28;--ink-soft:#4a5666;--green:#1d3fc4;--amber:#9a5b00;--line:#c9d1da;--white:#ffffff}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Source Serif 4',Georgia,'Times New Roman',serif;background:var(--paper);color:var(--ink);line-height:1.7;-webkit-font-smoothing:antialiased}
  .wrap{max-width:740px;margin:0 auto;padding:0 20px 60px}
  header{display:flex;justify-content:space-between;align-items:center;padding:20px 0;border-bottom:1px solid var(--line);font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px}
  header a{color:var(--green);text-decoration:none;font-weight:600}
  .kicker{font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13.5px;color:var(--green);margin:44px 0 12px}
  h1{font-family:'Archivo',system-ui,sans-serif;font-stretch:110%;font-size:clamp(30px,6vw,46px);line-height:1.08;letter-spacing:-.02em;margin:0 0 18px;font-weight:750}
  .lede{font-size:19px;color:var(--ink-soft)}
  h2{font-size:23px;margin:42px 0 8px;font-weight:600}
  h2 .n{font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:var(--amber);margin-right:10px;vertical-align:middle}
  p,li{font-size:16.5px}
  ul{padding-left:22px}
  li{margin:6px 0}
  a{color:var(--green)}
  .box{background:var(--white);border:1px solid var(--line);border-left:4px solid var(--green);padding:16px 20px;margin:22px 0}
  .box.warn{border-left-color:var(--amber)}
  .box b{font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:var(--green)}
  .box.warn b{color:var(--amber)}
  table{width:100%;border-collapse:collapse;margin:14px 0;font-size:15px;background:var(--white)}
  th,td{border:1px solid var(--line);padding:8px 10px;text-align:left}
  th{font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13.5px;color:var(--green)}
  .cta{display:inline-block;margin-top:10px;background:var(--green);color:var(--white);text-decoration:none;padding:13px 20px;font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;font-weight:600}
  footer{border-top:1px solid var(--line);margin-top:56px;padding-top:20px;font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13.5px;color:var(--ink-soft);line-height:1.7}
</style>
</head>
<body>
<div class="wrap">
<header><a href="/">iPatent \xB7 ipatent.qnfo.org</a><span>GUIDE \xB7 UPDATED 2 OCT 2026</span></header>

<div class="kicker">A guide for independent inventors</div>
<h1>Provisional patent applications: what they protect, and how to draft one that holds up</h1>
<p class="lede">A US provisional application is the cheapest way to put a date on an invention. It is also easy to get wrong in a way you only discover years later: a provisional protects exactly what it describes, and nothing else.</p>

<h2><span class="n">01</span>What a provisional is</h2>
<p>A provisional application (35 U.S.C. 111(b)) is a US filing that gives your invention an early effective filing date for twelve months. It is never examined and never becomes a patent on its own. It needs no claims, no inventor oath and no prior-art disclosure. To keep the date, you must file a regular (nonprovisional) US application, or an international PCT application, that claims the provisional's benefit within twelve months. Limited restoration of a missed deadline exists, but plan on twelve months.</p>
<p>While it is pending you may mark the invention "patent pending". The provisional itself is not published; it becomes public only if a later application that relies on it is published.</p>

<h2><span class="n">02</span>What it actually protects</h2>
<p>A later claim gets the provisional's filing date only if the provisional describes that claimed invention in writing and teaches a skilled person how to make and use it (the written-description and enablement requirements of 35 U.S.C. 112(a); see <i>New Railhead Mfg. v. Vermeer Mfg.</i>, Fed. Cir. 2002). If the feature that turns out to matter is missing or only gestured at, the early date does not cover it, and anything published in between can be used against you.</p>
<div class="box"><b>The rule of thumb</b><br>Write the provisional as if it were the only document a court will ever read about your invention. Breadth of description beats polish.</div>
<p>This is why iPatent puts the detailed description first and ends every draft with a <b>support gaps</b> list: the features, variants and drawings your description mentions but does not yet explain well enough. Closing those gaps is the most valuable thing you can do before filing.</p>

<h2><span class="n">03</span>What to put in it</h2>
<ul>
  <li><b>The problem and context:</b> what existing approaches do and where they fall short.</li>
  <li><b>The parts and how they connect:</b> every component, what it does and what it talks to.</li>
  <li><b>How and why it works:</b> the operating principle, not just the result.</li>
  <li><b>At least one fully worked embodiment:</b> concrete materials, dimensions, values, steps, code paths or parameters.</li>
  <li><b>Alternatives and variants:</b> every substitution you might later want to claim (other materials, ranges, configurations, orders of steps). Unmentioned variants are unprotected.</li>
  <li><b>Drawings:</b> required where they help understanding (35 U.S.C. 113). Describe each figure in the text, with reference numbers.</li>
  <li><b>Data or test results,</b> if you have them, and the uses you foresee.</li>
  <li><b>Claims and an abstract (optional):</b> not required for a provisional, but a draft claim set is a useful checklist of what the description must support.</li>
</ul>

<h2><span class="n">04</span>Filing it</h2>
<p>File through USPTO Patent Center with a cover sheet (form PTO/SB/16, or an application data sheet) naming every inventor, the specification and any drawings, and the fee. Fees in effect since 19 January 2025:</p>
<table>
  <tr><th>Entity status</th><th>Provisional filing fee</th></tr>
  <tr><td>Large entity</td><td>$325</td></tr>
  <tr><td>Small entity</td><td>$130</td></tr>
  <tr><td>Micro entity (income and filing limits apply)</td><td>$65</td></tr>
</table>
<p>A size fee applies above 100 sheets. Always confirm against the current <a href="https://www.uspto.gov/learning-and-resources/fees-and-payment/uspto-fee-schedule" rel="noopener">USPTO fee schedule</a> before you pay.</p>

<h2><span class="n">05</span>Keep it secret until it is filed</h2>
<div class="box warn"><b>Before you post, pitch or publish</b><br>The US gives inventors a one-year grace period for their own disclosures (35 U.S.C. 102(b)(1)). Europe and most other countries do not: under the European Patent Convention (Art. 54) anything made public before your filing date, including your own blog post, talk, preprint or demo, can destroy novelty there.</div>
<p>The same applies to software. Pasting an unfiled invention into a tool that stores, shares or publishes what you type can be a disclosure. The USPTO's 2024 guidance on AI tools warns practitioners about exactly this confidentiality risk. iPatent stores nothing unless you tick "keep a private copy", and never lists or publishes submissions.</p>

<h2><span class="n">06</span>What iPatent does, and what it does not</h2>
<ul>
  <li><b>It drafts with AI.</b> An AI language model turns your description into a structured disclosure in patent register, grounded in the structure of a 33,500-segment corpus of the author's own draft disclosures.</li>
  <li><b>It does not search prior art.</b> Its closeness warning compares your text with that corpus only. It is not a novelty or freedom-to-operate opinion.</li>
  <li><b>It is not legal advice.</b> Machine-generated text can be wrong or invent details. Under USPTO rules a person, not a tool, signs and is responsible for every statement filed. Have a registered patent attorney or agent review the draft.</li>
  <li><b>Inventors are people.</b> US law names only natural persons as inventors (<i>Thaler v. Vidal</i>, Fed. Cir. 2022). The invention has to be yours; the tool only helps you write it down.</li>
</ul>
<a class="cta" href="/#draft">Draft a disclosure</a>

<h2><span class="n">07</span>More guides</h2>
<ul>${GUIDE_PAGES.map((p) => '<li><a href="/guide/' + p.slug + '">' + escapeHtml(p.title) + "</a></li>").join("")}</ul>

<footer>
iPatent is a free, open experiment from <a href="https://qnfo.org">QNFO</a> by Rowan Brad Quni-Gudzinas (<a href="https://orcid.org/0009-0002-4317-5604">ORCID</a>). <a href="https://qnfo.org/work-with-me?utm_source=ipatent&amp;utm_medium=referral&amp;utm_campaign=ipatent-guide">Work with me</a> · <a href="/example">See a real run</a>. Source code is public at <a href="https://github.com/QNFO/qnfo-workers/tree/main/qnfo-ipatent">github.com/QNFO/qnfo-workers</a>. This guide is general information, not legal advice, and reflects US law and USPTO fees as of 2 October 2026.
</footer>
</div>
<div class="box">
<h2>Get new guides by email</h2>
<form id="subscribe-form">
  <input type="email" name="email" required placeholder="Your email address">
  ${turnstileWidget(null, "ipatent_subscribe")}
  <button type="submit">Subscribe</button>
  <span id="status-message"></span>
</form>
${TURNSTILE_SCRIPT}
<script>
document.getElementById('subscribe-form').addEventListener('submit', function(event) {
  event.preventDefault();
  const email = this.email.value;
  fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, source: 'ipatent-guide', cf_turnstile: (this.querySelector('[name=cf-turnstile-response]') || {}).value || '' })
  }).then(response => response.json())
    .then(data => {
      document.getElementById('status-message').textContent = 'Check your inbox to confirm your subscription.';
    })
    .catch(error => {
      document.getElementById('status-message').textContent = 'Error: ' + error.message;
    });
});
</script>
</div>
${fleetCtlLink(CANONICAL_ORIGIN + "/guide")}
</body>
</html>`;

function shareLinks(url, text) {
  const u = encodeURIComponent(url), t = encodeURIComponent(text);
  return [
    ["LinkedIn", "https://www.linkedin.com/sharing/share-offsite/?url=" + u],
    ["Bluesky", "https://bsky.app/intent/compose?text=" + encodeURIComponent(text + " " + url)],
    ["X", "https://x.com/intent/post?text=" + t + "&url=" + u],
    ["Email", "mailto:?subject=" + encodeURIComponent("iPatent: free provisional patent drafting") + "&body=" + encodeURIComponent(text + "\n\n" + url)]
  ].map(([n, h]) => '<a href="' + h + '" rel="noopener" target="_blank">' + n + "</a>").join(" · ");
}
__name(shareLinks, "shareLinks");
var EXAMPLE_WRONG = [
  ["Claim 3 invents a torque range.", "It claims a calibrated torque of 0.5 to 2.0 N·m. The inventor gave no torque, and neither does the description. The value check marks it unsupported."],
  ["Claim 6 invents a material.", "Silicone rubber with a Shore A hardness of 40 to 60 appears nowhere in the input or the description. The support map marks it unsupported."],
  ["The description adds dimensions nobody gave.", "A 30 mm pin length and a thickness under 12 mm are the model's, not the inventor's. The support map checks claims against the description, so it cannot catch this: every number in the description must come from you."],
  ["The abstract promises things that are not there.", "It says the disclosure also provides a method of assembly, a system and a computer-readable medium. None is described."],
  ["The reviewer notes cite a claim that does not exist.", "They mention a protective coating in claim 14; the draft has six claims."]
];
function renderExamplePage() {
  const esc = escapeHtml;
  const paragraphs = specParagraphs(EXAMPLE_SECTIONS);
  const sm = supportMap(EXAMPLE_SECTIONS.claims || "", paragraphs);
  const para = (key) => paragraphs.filter((p) => p.key === key).map((p) => '<p class="para"><span class="pn">' + paraNo(p.n) + "</span> " + esc(p.text) + "</p>").join("");
  const claims = String(EXAMPLE_SECTIONS.claims || "").replace(/\*\*/g, "").split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => '<p class="claim">' + esc(l) + "</p>").join("");
  const rows = sm.rows.map((r) => '<tr class="' + r.status + '"><td>' + r.claim + "</td><td>" + esc(r.element) + "</td><td>" + (r.paragraph ? paraNo(r.paragraph) : "none") + "</td><td><b>" + r.status + "</b> (" + Math.round(r.coverage * 100) + "%)" + (r.missing_values && r.missing_values.length ? "<br>values not in description: " + esc(r.missing_values.join(", ")) : "") + "</td></tr>").join("");
  const wrong = EXAMPLE_WRONG.map(([h, t]) => "<li><b>" + esc(h) + "</b> " + esc(t) + "</li>").join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>A real AI-drafted provisional, and what it got wrong · iPatent</title>
<meta name="description" content="One unedited run of iPatent on a simple hinge invention: the full provisional draft, the claim-support map, and the five things the AI invented that an inventor must catch before filing.">
<link rel="canonical" href="https://ipatent.qnfo.org/example">
<meta name="author" content="Rowan Brad Quni-Gudzinas">
<meta property="og:type" content="article">
<meta property="og:site_name" content="QNFO">
<meta property="og:title" content="A real AI-drafted provisional patent, and what it got wrong">
<meta property="og:description" content="Useful structure, invented facts: an unedited run with its claim-support map and the five errors an inventor must catch.">
<meta property="og:url" content="https://ipatent.qnfo.org/example">
<meta property="og:image" content="https://ipatent.qnfo.org/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"A real AI-drafted provisional patent, and what it got wrong","url":"https://ipatent.qnfo.org/example","dateModified":"2026-10-02","author":{"@type":"Person","name":"Rowan Brad Quni-Gudzinas","sameAs":["https://orcid.org/0009-0002-4317-5604"]},"publisher":{"@type":"Organization","name":"QNFO","url":"https://qnfo.org"}}<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Source+Serif+4:opsz,wght@8..60,400..700&display=swap" rel="stylesheet">
<style>
  :root{--paper:#eef1f4;--ink:#131c28;--ink-soft:#4a5666;--green:#1d3fc4;--amber:#9a5b00;--line:#c9d1da;--white:#ffffff;--red:#9a2f2f}
  *{box-sizing:border-box} body{margin:0;font-family:'Source Serif 4',Georgia,'Times New Roman',serif;background:var(--paper);color:var(--ink);line-height:1.7}
  .wrap{max-width:780px;margin:0 auto;padding:0 18px 60px} header{display:flex;justify-content:space-between;padding:20px 0;border-bottom:1px solid var(--line);font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px}
  header a,a{color:var(--green)} h1{font-family:'Archivo',system-ui,sans-serif;font-stretch:110%;letter-spacing:-.02em;font-size:clamp(28px,6vw,42px);line-height:1.1;margin:36px 0 12px} h2{font-size:22px;margin:36px 0 8px}
  .lede{font-size:18px;color:var(--ink-soft)} .box{background:var(--white);border:1px solid var(--line);padding:14px 18px;margin:16px 0}
  .warn{border-left:4px solid var(--red)} .mono{font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:var(--ink-soft)}
  .para,.claim{margin:0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere} td{overflow-wrap:anywhere} .pn{font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13.5px;color:var(--green);margin-right:6px}
  table{width:100%;border-collapse:collapse;font-size:14px;background:var(--white)} td,th{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
  tr.unsupported td{background:#fbeceb} tr.weak td{background:#fff6e0} li{margin:8px 0}
  .cta{display:inline-block;margin:10px 10px 0 0;background:var(--green);color:var(--white);text-decoration:none;padding:12px 18px;font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px}
  .cta.alt{background:var(--white);color:var(--green);border:1px solid var(--green)} footer{border-top:1px solid var(--line);margin-top:48px;padding-top:16px}
</style>
</head>
<body><div class="wrap">
<header><a href="/">iPatent · ipatent.qnfo.org</a><span>EXAMPLE · ${esc(EXAMPLE_META.date)}</span></header>
<h1>A real AI-drafted provisional, and what it got wrong</h1>
<p class="lede">One unedited run of iPatent (${esc(EXAMPLE_META.model)}, ${EXAMPLE_META.seconds} seconds) on a five-sentence description of a folding drawer hinge. The structure is useful. Several facts are invented, and the support map catches the ones in the claims.</p>
<h2>What the inventor typed</h2>
<div class="box"><b>${esc(EXAMPLE_INPUT.title)}</b><br>${esc(EXAMPLE_INPUT.description)}</div>
<h2>What the run got wrong</h2>
<div class="box warn"><ol>${wrong}</ol><p>The lesson: use AI for structure and for the checklist of what is missing. Every fact, every number and every claim limitation must come from you.</p></div>
<h2>Support map: ${sm.supported} of ${sm.elements} claim elements supported, ${sm.unsupported} unsupported</h2>
<p class="mono">${esc(sm.method)}</p>
<div style="overflow-x:auto"><table><tr><th>Claim</th><th>Element</th><th>Best paragraph</th><th>Verdict</th></tr>${rows}</table></div>
<h2>The draft, unedited</h2>
<h3>Technical field</h3>${para("technical_field")}
<h3>Background</h3>${para("background")}
<h3>Summary</h3>${para("summary")}
<h3>Detailed description</h3>${para("detailed_description")}
<h3>Claims</h3>${claims}
<h3>Abstract</h3><p class="para">${esc(EXAMPLE_SECTIONS.abstract || "")}</p>
<h3>Reviewer notes from the model (support gaps)</h3><p class="para">${esc(EXAMPLE_SECTIONS.support_gaps || "")}</p>
<a class="cta" href="/#draft">Draft your own, free</a><a class="cta alt" href="/guide">Read the provisional guide</a>
<form action="/api/subscribe" method="post" style="margin-bottom: 20px;">
  <input type="email" name="email" required placeholder="Enter your email" style="padding: 8px; margin-right: 10px; border: 1px solid var(--line);">
  <input type="hidden" name="source" value="example">
  <button type="submit" class="cta">Subscribe</button>
</form>
<footer><p>Share this example: ${shareLinks("https://ipatent.qnfo.org/example?utm_source=share&utm_medium=social&utm_campaign=ipatent-example", "A real AI-drafted provisional patent, and the five things it invented")}</p>
<p class="mono">Built by Rowan Brad Quni-Gudzinas (<a href="https://orcid.org/0009-0002-4317-5604">ORCID</a>) at <a href="https://qnfo.org">QNFO</a>. Want a human review, iPatent for your team or institution, or to collaborate? <a href="https://qnfo.org/work-with-me?utm_source=ipatent&utm_medium=referral&utm_campaign=ipatent">Work with me</a>. Not legal advice.</p></footer>
</div>${fleetCtlLink(CANONICAL_ORIGIN + "/example")}</body></html>`;
}
__name(renderExamplePage, "renderExamplePage");

// ---- GUIDED-FLOW-1:BEGIN (IPATENT-UI-OVERHAUL-1 step 1, agent_issues 2049): the ?v=2 guided flow (describe, mechanism card,
// draft, support map, fix gaps, file). ipDeadline is the 12-month date the flow puts in front of the inventor: a US
// nonprovisional or PCT/Paris filing must follow the provisional within 12 months (35 U.S.C. 119(e), Paris Art. 4), and
// a date that falls on a Saturday or Sunday moves to the next Monday (35 U.S.C. 21(b)); federal holidays are named in
// the copy, not computed. The same function runs in the page (stringified below) and in the suite.
function ipDeadline(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  var y = Number(m[1]) + 1, mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  var dt = new Date(Date.UTC(y, mo - 1, Math.min(d, last)));
  var dow = dt.getUTCDay(), rolled = false;
  if (dow === 6) { dt.setUTCDate(dt.getUTCDate() + 2); rolled = true; }
  else if (dow === 0) { dt.setUTCDate(dt.getUTCDate() + 1); rolled = true; }
  return { due: dt.toISOString().slice(0, 10), rolled: rolled, weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dt.getUTCDay()] };
}
__name(ipDeadline, "ipDeadline");
// One VEVENT for the 12-month date, with reminders 60 and 14 days before; built in the page, nothing leaves the browser.
function ipDeadlineIcs(due, title) {
  var ymd = String(due).replace(/-/g, "");
  var safe = String(title || "my invention").replace(/[\r\n,;]+/g, " ").slice(0, 120);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//QNFO//iPatent//EN", "BEGIN:VEVENT", "UID:ipatent-" + ymd + "-" + safe.length + "@ipatent.qnfo.org",
    "DTSTAMP:" + ymd + "T000000Z", "DTSTART;VALUE=DATE:" + ymd, "SUMMARY:12-month deadline: nonprovisional / PCT for " + safe,
    "DESCRIPTION:The provisional for " + safe + " expires. File the nonprovisional and any PCT or foreign application by today. Confirm the date with a registered practitioner.",
    "BEGIN:VALARM", "TRIGGER:-P60D", "ACTION:DISPLAY", "DESCRIPTION:60 days to the 12-month patent deadline", "END:VALARM",
    "BEGIN:VALARM", "TRIGGER:-P14D", "ACTION:DISPLAY", "DESCRIPTION:14 days to the 12-month patent deadline", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
__name(ipDeadlineIcs, "ipDeadlineIcs");
var FLOW_STEPS = [["describe", "Describe"], ["mechanism", "Mechanism"], ["draft", "Draft"], ["map", "Support map"], ["fix", "Fix gaps"], ["file", "File"]];
var FLOW_PAGE_JS = "var ipDeadline = " + ipDeadline.toString() + ";\nvar ipDeadlineIcs = " + ipDeadlineIcs.toString() + ";\nvar FLOW_STEPS = " + JSON.stringify(FLOW_STEPS) + ";";
function flowRailHtml() {
  return '<nav class="flow" id="flowRail" style="display:none" data-flow="v2" aria-label="Guided flow"><ol>' + FLOW_STEPS.map(function (st, i) {
    return '<li><a href="#flow-' + st[0] + '" data-step="' + st[0] + '" class="fs todo"><span class="fn">' + (i + 1) + '</span><span class="fl">' + st[1] + '</span></a></li>';
  }).join("") + '</ol></nav>';
}
__name(flowRailHtml, "flowRailHtml");
// ---- GUIDED-FLOW-1:END
var LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>iPatent \u2014 free, private US provisional patent disclosure drafting \xB7 QNFO</title>
<meta name="description" content="Draft a US provisional patent application disclosure for free: specification, drawings checklist, optional claims and abstract. Private by default, nothing published. An open experiment from QNFO.">
<link rel="canonical" href="https://ipatent.qnfo.org/">
<meta name="robots" content="index,follow">
<meta name="author" content="Rowan Brad Quni-Gudzinas">
<meta property="og:type" content="website">
<meta property="og:site_name" content="QNFO">
<meta property="og:title" content="iPatent \u2014 free, private provisional patent disclosure drafting">
<meta property="og:description" content="Describe your invention; get a complete, reviewable US provisional disclosure draft. Private by default. Not legal advice.">
<meta property="og:url" content="https://ipatent.qnfo.org/">
<meta property="og:image" content="https://ipatent.qnfo.org/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"iPatent","url":"https://ipatent.qnfo.org/","applicationCategory":"BusinessApplication","operatingSystem":"Any (web)","isAccessibleForFree":true,"offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"description":"Free, private-by-default assistant that drafts US provisional patent application disclosures for review by a registered practitioner.","author":{"@type":"Person","name":"Rowan Brad Quni-Gudzinas","sameAs":["https://orcid.org/0009-0002-4317-5604"]},"publisher":{"@type":"Organization","name":"QNFO","url":"https://qnfo.org"}}<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Source+Serif+4:opsz,wght@8..60,400..700&display=swap" rel="stylesheet">
<script>if(new URLSearchParams(location.search).get('v')==='2')document.documentElement.classList.add('v2');<\/script>
<style>
  /* IPATENT-UI-OVERHAUL-1 (3.17.0): drawing-sheet system. Cool sheet ground, ink rules, one action blue; green, amber and
     red are kept for the support states only. Archivo for the interface, Source Serif 4 for the document being drafted. */
  :root{
    --sheet:#eef1f4; --paper:#f6f8fa; --paper-deep:#e3e8ee; --white:#ffffff;
    --ink:#131c28; --ink-soft:#4a5666; --line:#c9d1da; --edge:#8792a1;
    --blue:#1d3fc4; --blue-deep:#142e94; --blue-t:#e6ebfb;
    --green:#17734a; --green-t:#e3f1ea; --amber:#9a5b00; --amber-t:#fbefd9; --danger:#b3261e; --danger-t:#fbe9e7;
    --ui:'Archivo',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
    --read:'Source Serif 4',Georgia,'Times New Roman',serif;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
  @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  body{margin:0;background:var(--sheet);color:var(--ink);font-family:var(--ui);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
  h1,h2,h3,p,ul,ol,dl,dd,figure{margin:0}
  a{color:var(--blue);text-underline-offset:3px}
  a:hover{color:var(--blue-deep)}
  :focus-visible{outline:3px solid var(--blue);outline-offset:2px;border-radius:2px}
  button{font:inherit;cursor:pointer}
  .skip{position:absolute;left:-9999px;top:0;background:var(--ink);color:var(--white);padding:10px 14px;z-index:20}
  .skip:focus{left:8px;top:8px}
  .sr{position:absolute;left:-9999px}
  .wrap{max-width:1180px;margin:0 auto;padding:0 16px 56px}
  @media(min-width:720px){.wrap{padding:0 32px 72px}}

  /* masthead */
  .top{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap;padding:18px 0 14px;border-bottom:2px solid var(--ink)}
  .mark{font-weight:800;font-stretch:118%;font-size:22px;letter-spacing:-.01em;color:var(--ink);text-decoration:none}
  .mark small{font-weight:500;font-stretch:100%;font-size:14px;color:var(--ink-soft);letter-spacing:0;margin-left:8px}
  .top nav{display:flex;gap:6px 22px;flex-wrap:wrap;font-size:15px;font-weight:600}
  .top nav a{color:var(--ink);text-decoration:none;padding:4px 0}
  .top nav a:hover{text-decoration:underline}

  /* hero */
  .hero{display:grid;gap:36px;padding:44px 0 8px;align-items:start}
  @media(min-width:940px){.hero{grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:56px;padding:72px 0 16px}}
  .hero h1{font-size:clamp(34px,5.4vw,62px);line-height:1.02;font-weight:750;font-stretch:112%;letter-spacing:-.022em;max-width:15ch}
  .hero .sub{font-size:clamp(17px,1.6vw,19px);line-height:1.5;color:var(--ink);max-width:58ch;margin-top:22px}
  .hero .terms{font-size:15px;color:var(--ink-soft);max-width:60ch;margin-top:14px}
  .go{display:flex;flex-wrap:wrap;gap:12px 22px;align-items:center;margin-top:28px}
  .btn-p,#generateBtn,#fixRedraft,#icsBtn,#subBtn{background:var(--blue);color:var(--white);border:1.5px solid var(--blue);border-radius:4px;padding:14px 22px;font-size:16px;font-weight:650;line-height:1.2;text-decoration:none;display:inline-block;text-align:center}
  .btn-p:hover,#generateBtn:hover,#fixRedraft:hover,#icsBtn:hover,#subBtn:hover{background:var(--blue-deep);border-color:var(--blue-deep);color:var(--white)}
  button:disabled{opacity:.6;cursor:wait}
  .invent{background:var(--white);color:var(--ink);border:1.5px solid var(--ink);border-radius:4px;padding:14px 22px;font-size:16px;font-weight:650;line-height:1.2}
  .invent:hover{background:var(--paper-deep);color:var(--ink)}
  .fig{background:var(--white);border:1px solid var(--ink);padding:18px 14px 12px}
  .fig svg{display:block;width:100%;height:auto;max-width:400px;margin:0 auto}
  .fig figcaption{font-family:var(--read);font-size:15px;line-height:1.45;color:var(--ink);border-top:1px solid var(--line);margin-top:12px;padding-top:10px}
  .fig text{font-family:var(--ui);fill:var(--ink)}

  /* workspace: step rail beside the form and the result */
  .work{display:grid;grid-template-columns:minmax(0,1fr);gap:0 40px;margin-top:48px}
  html.v2 #flowRail{display:block!important}
  .flow{position:sticky;top:0;z-index:5;background:var(--sheet);border-bottom:1px solid var(--line);margin:0 -16px 20px;padding:8px 16px;overflow-x:auto}
  .flow ol{list-style:none;display:flex;gap:4px;padding:0}
  .fs{display:flex;align-items:center;gap:9px;padding:7px 10px 7px 7px;border-radius:4px;text-decoration:none;white-space:nowrap;font-size:14px;font-weight:600;color:var(--ink-soft)}
  .fn{flex:none;width:24px;height:24px;border-radius:50%;border:1.5px solid currentColor;display:grid;place-items:center;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
  .fs.active{color:var(--ink);background:var(--white);box-shadow:inset 0 0 0 1.5px var(--ink)}
  .fs.active .fn{background:var(--ink);border-color:var(--ink);color:var(--white)}
  .fs.done{color:var(--green)}
  .fs.done .fn{background:var(--green);border-color:var(--green);color:var(--white);font-size:0}
  .fs.done .fn::before{content:"✓";font-size:13px}
  .fs.warn{color:var(--amber)}
  .fs.warn .fn{background:var(--amber);border-color:var(--amber);color:var(--white);font-size:0}
  .fs.warn .fn::before{content:"!";font-size:13px}
  @media(min-width:980px){
    html.v2 .work{grid-template-columns:184px minmax(0,1fr)}
    .flow{top:20px;align-self:start;margin:0;padding:0;border:0;overflow:visible;background:none}
    .flow ol{flex-direction:column;gap:2px;border-left:1.5px solid var(--line);padding-left:10px}
  }
  .flow-a,#flow-map,#flow-fix,#flow-file{display:block;scroll-margin-top:64px}

  /* the form */
  .form-card{background:var(--white);border:1px solid var(--ink);border-radius:2px}
  .form-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px 20px;flex-wrap:wrap;padding:18px 18px 14px;border-bottom:1px solid var(--line)}
  .form-head h2{font-size:24px;font-weight:700;font-stretch:108%;letter-spacing:-.01em;line-height:1.15}
  .form-head span{font-size:14px;color:var(--ink-soft)}
  #draftForm{padding:6px 18px 22px}
  @media(min-width:720px){.form-head{padding:22px 28px 16px}#draftForm{padding:8px 28px 28px}}
  .field{margin-top:22px}
  .field label,.dl-row label{display:block;font-size:15px;font-weight:650;margin-bottom:6px}
  .opt{font-weight:400;color:var(--ink-soft)}
  .hint{font-size:14px;color:var(--ink-soft);margin:-2px 0 8px;max-width:70ch}
  input[type=text],input[type=email],input[type=date],input:not([type]),textarea{width:100%;font-family:var(--ui);font-size:16px;line-height:1.5;color:var(--ink);background:var(--white);border:1px solid var(--edge);border-radius:4px;padding:11px 13px}
  input::placeholder,textarea::placeholder{color:#6b7787;opacity:1}
  input:focus,textarea:focus{outline:3px solid var(--blue-t);outline-offset:0;border-color:var(--blue)}
  textarea{resize:vertical;min-height:96px}
  #description{min-height:230px}
  .q3{display:grid;gap:10px;margin:4px 0 12px}
  @media(min-width:760px){.q3{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}}
  .q3 div{border-left:3px solid var(--blue);padding:2px 0 2px 12px}
  .q3 dt{font-weight:700;font-size:15px}
  .q3 dd{font-size:14px;color:var(--ink-soft);line-height:1.45}
  .meter{margin-top:12px;font-size:14px;color:var(--ink-soft)}
  .meter b{color:var(--ink)}
  .meter-bar{height:6px;background:var(--paper-deep);margin:8px 0 10px;border-radius:3px;overflow:hidden}
  .meter-fill{height:100%;background:var(--ink);transition:width .25s}
  @media(prefers-reduced-motion:reduce){.meter-fill{transition:none}}
  .meter-items{display:flex;flex-wrap:wrap;gap:6px 8px}
  .mi{font-size:13px;font-weight:600;padding:3px 10px 3px 8px;border-radius:3px;border:1px solid var(--line);color:var(--ink-soft);background:var(--paper)}
  .mi::before{content:"○ "}
  .mi.ok{color:var(--green);border-color:var(--green);background:var(--green-t)}
  .mi.ok::before{content:"✓ "}
  #mechZone{border-top:1px solid var(--line);padding-top:22px}
  #mechZone h3,.samples summary{font-size:17px;font-weight:700}
  .note{font-size:14px;line-height:1.5;color:var(--ink-soft);max-width:78ch}
  .note b{color:var(--ink)}
  #mechCard label{font-size:14px}
  #mechCard textarea{font-size:15px}
  .samples{margin-top:22px;border-top:1px solid var(--line);padding-top:16px}
  .samples summary{cursor:pointer;font-size:15px;font-weight:650;color:var(--blue)}
  .sug-head{font-size:14px;font-weight:650;margin:14px 0 8px}
  .sug-head span{font-weight:400;color:var(--ink-soft)}
  .sug-chips{display:flex;flex-wrap:wrap;gap:8px}
  .sug-chip{background:var(--white);border:1px solid var(--edge);border-radius:4px;padding:7px 12px;font-size:14px;color:var(--ink);text-align:left;max-width:100%;overflow-wrap:anywhere}
  .sug-chip:hover{border-color:var(--blue);color:var(--blue)}
  .sug-empty,.g-empty,.g-note{font-size:14px;color:var(--ink-soft)}
  .guide{margin-top:6px}
  .g-row{font-size:14px;padding:6px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
  .g-pct{color:var(--ink-soft);font-variant-numeric:tabular-nums}
  .g-note{margin-top:8px}
  .row{display:grid;gap:0 20px}
  @media(min-width:640px){.row{grid-template-columns:1fr 1fr}}
  .actions{margin-top:26px;border-top:1px solid var(--line);padding-top:22px}
  .keep{display:flex;gap:10px;align-items:flex-start;font-size:15px;line-height:1.45;cursor:pointer;max-width:74ch}
  .keep input{width:18px;height:18px;margin:2px 0 0;flex:none;accent-color:var(--blue)}
  .actions-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px}
  .actions-row button{flex:1 1 220px}
  @media(min-width:640px){.actions-row button{flex:0 1 auto}}
  .status{font-size:15px;margin-top:12px;color:var(--ink);overflow-wrap:anywhere;min-height:0}
  .status.err{color:var(--danger);font-weight:600}
  .actions .note{margin-top:16px}

  /* the result */
  #result{display:none;margin-top:40px}
  .result-head{display:flex;justify-content:space-between;align-items:baseline;gap:6px 20px;flex-wrap:wrap;margin-bottom:14px}
  .result-head h2{font-size:24px;font-weight:700;font-stretch:108%;letter-spacing:-.01em}
  #resultId{font-size:14px;color:var(--ink-soft);font-variant-numeric:tabular-nums}
  #dlBar{align-items:center}
  #dlBar .invent{padding:10px 16px;font-size:15px}
  #dlBar a{font-size:15px;font-weight:600}
  .close-warn{background:var(--amber-t);border:1px solid var(--amber);border-left-width:4px;padding:14px 16px;margin:0 0 16px;font-size:15px;line-height:1.5}
  .fz{background:var(--white);border:1px solid var(--ink);border-radius:2px;padding:20px 18px;margin:0 0 20px}
  .paper+.fz{margin-top:20px}
  @media(min-width:720px){.fz{padding:26px 28px}}
  .fk{font-size:14px;font-weight:650;color:var(--ink-soft)}
  .fz h2{font-size:24px;font-weight:700;font-stretch:108%;letter-spacing:-.01em;line-height:1.15;margin:2px 0 8px}
  .fz p{font-size:15.5px;max-width:76ch}
  .sm-score{font-size:52px;font-weight:750;font-stretch:112%;letter-spacing:-.02em;line-height:1;margin-top:18px;font-variant-numeric:tabular-nums}
  .sm-score small{font-size:16px;font-weight:500;font-stretch:100%;letter-spacing:0;color:var(--ink-soft)}
  .sm-bar{display:flex;height:16px;border:1px solid var(--ink);margin:12px 0 8px;background:var(--paper)}
  .sm-bar .b-s{background:var(--green)}
  .sm-bar .b-w{background:var(--amber)}
  .sm-bar .b-u{background:var(--danger)}
  .sm-legend{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:14px;font-weight:600}
  .smap{font-family:var(--ui);font-size:14.5px;line-height:1.5;margin-top:18px;padding:14px 16px;background:var(--paper);border-left:3px solid var(--ink)}
  .smap a{font-weight:600}
  .sm-row{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;margin-top:10px;padding:10px 12px;background:var(--white);border:1px solid var(--line);border-left:4px solid var(--edge);font-variant-numeric:tabular-nums}
  .sm-row>div:first-child{font-weight:700}
  .sm-row.supported{border-left-color:var(--green)}
  .sm-row.weak{border-left-color:var(--amber);background:var(--amber-t)}
  .sm-row.unsupported{border-left-color:var(--danger);background:var(--danger-t)}
  .sm-el{font-family:var(--read);font-size:15.5px;color:var(--ink);overflow-wrap:anywhere}
  .sm-meta{font-size:13px;color:var(--ink-soft);margin-top:3px;overflow-wrap:anywhere}
  .sm-st{font-weight:700}
  .supported .sm-st{color:var(--green)}
  .weak .sm-st{color:var(--amber)}
  .unsupported .sm-st{color:var(--danger)}
  .paper{position:relative;background:var(--white);border:1px solid var(--ink);padding:30px 18px;font-family:var(--read);font-size:16.5px;line-height:1.7;overflow:hidden}
  @media(min-width:720px){.paper{padding:52px 60px}}
  .paper .wm{position:absolute;top:16px;right:16px;border:2px solid var(--danger);color:var(--danger);font-family:var(--ui);font-size:13px;font-weight:800;letter-spacing:.1em;padding:1px 10px;transform:rotate(4deg)}
  .paper .pno{font-family:var(--ui);font-size:14px;color:var(--ink-soft);padding-right:90px;margin-bottom:22px}
  .paper h3{font-family:var(--ui);font-size:14px;font-weight:750;letter-spacing:.02em;border-bottom:1px solid var(--ink);padding-bottom:5px;margin:30px 0 12px}
  .paper h3:first-child{margin-top:0}
  .paper .sec{white-space:pre-wrap;overflow-wrap:anywhere}
  .paper .para{margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}
  .paper .pn{font-family:var(--ui);font-size:12.5px;font-weight:600;color:var(--blue);margin-right:8px;font-variant-numeric:tabular-nums}
  .paper .claim{padding:8px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
  .paper .claim:last-child{border-bottom:0}
  .src{font-family:var(--ui);font-size:13.5px;color:var(--ink-soft);margin-top:26px;border-top:1px solid var(--line);padding-top:12px}
  .src-row{margin-top:4px;overflow-wrap:anywhere}
  .gap-item{border:1px solid var(--line);border-left:4px solid var(--amber);padding:14px;margin:14px 0}
  .gap-item.unsupported,.gap-item.hole{border-left-color:var(--danger)}
  .gl{font-size:14px;font-weight:700}
  .gw{font-size:15px;margin:3px 0;overflow-wrap:anywhere}
  .gap-item textarea{margin-top:8px;min-height:70px}
  .btns{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px;align-items:stretch}
  .btns>*{flex:1 1 240px}
  @media(min-width:640px){.btns>*{flex:0 1 auto}}
  .dl-row{display:grid;gap:14px 20px;margin-top:16px}
  @media(min-width:640px){.dl-row{grid-template-columns:1fr 1fr}}
  .deadline{margin-top:16px;border:1.5px solid var(--ink);padding:16px 18px;font-size:15.5px;line-height:1.5}
  .deadline .big{display:block;font-size:clamp(26px,4.6vw,38px);font-weight:750;font-stretch:112%;letter-spacing:-.015em;line-height:1.15;margin:2px 0 6px;font-variant-numeric:tabular-nums}

  /* after the tool */
  .after{display:grid;gap:36px;margin-top:72px;padding-top:36px;border-top:2px solid var(--ink)}
  @media(min-width:860px){.after{grid-template-columns:1fr 1fr;gap:56px}}
  .after h2,.sub-box h2{font-size:24px;font-weight:700;font-stretch:108%;letter-spacing:-.01em;line-height:1.15;margin-bottom:12px}
  .after ul{padding-left:20px;max-width:62ch}
  .after li{margin:10px 0}
  .ref{margin-top:56px;padding-top:36px;border-top:1px solid var(--line)}
  .ref h2{font-size:24px;font-weight:700;font-stretch:108%;letter-spacing:-.01em;margin-bottom:6px}
  .ref p{color:var(--ink-soft);max-width:70ch}
  .ref ul{list-style:none;padding:0;margin-top:16px;display:grid;gap:0 40px}
  @media(min-width:760px){.ref ul{grid-template-columns:1fr 1fr}}
  .ref li{border-bottom:1px solid var(--line)}
  .ref li a{display:block;padding:11px 0;font-weight:600;text-decoration:none;color:var(--ink)}
  .ref li a:hover{color:var(--blue);text-decoration:underline}
  .sub-box{margin-top:56px;background:var(--white);border:1px solid var(--line);padding:22px 18px}
  @media(min-width:720px){.sub-box{padding:28px}}
  .sub-box p{max-width:70ch}
  #subForm{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;max-width:560px}
  #subEmail{flex:1 1 220px;width:auto}
  #subMsg{font-size:14px;margin-top:8px;color:var(--ink-soft)}
  footer{margin-top:56px;padding-top:20px;border-top:2px solid var(--ink);font-size:14px;color:var(--ink-soft);line-height:1.6}
  .foot{display:grid;gap:14px}
  .foot nav{display:flex;flex-wrap:wrap;gap:6px 22px;font-weight:600}
  .foot nav a{color:var(--ink)}
  .f-legal{max-width:86ch}
  .f-legal b{color:var(--ink)}
  @media print{
    .top,.hero,.flow,.form-card,.result-head,#dlBar,.close-warn,#smHero,#fixZone,#fileZone,.after,.ref,.sub-box,footer,.skip{display:none!important}
    body{background:#fff}
    .wrap{padding:0;max-width:none}
    .work{display:block;margin:0}
    #result{margin:0}
    .paper{border:0;padding:0}
  }
</style>
</head>
<body>
<a class="skip" href="#draft">Skip to the drafting form</a>
<div class="wrap">
  <header class="top">
    <a class="mark" href="/">iPatent<small>by QNFO</small></a>
    <nav aria-label="Site">
      <a href="#draft">Draft</a>
      <a href="/guide">Guides</a>
      <a href="/example">Worked example</a>
      <a href="#limits">Limits</a>
    </nav>
  </header>

  <section class="hero">
    <div>
      <h1>A provisional patent protects only what it describes.</h1>
      <p class="sub">iPatent drafts the disclosure for a US provisional application from your own description of the invention: what it is, what it does and how it works. Then it checks every claim element against the text, so you see what is taught and what is missing before you file.</p>
      <p class="terms"><b>iPatent is an AI system:</b> an AI language model writes the draft and checks it against your description. Free, with no account. Nothing is stored unless you ask for a private copy. iPatent drafts a disclosure; it is not legal advice and it files nothing.</p>
      <div class="go">
        <a class="btn-p" href="#draft">Start a draft</a>
        <a href="/example">See a real run and what it got wrong</a>
      </div>
    </div>
    <figure class="fig">
      <svg viewBox="0 0 360 400" role="img" aria-labelledby="figT figD">
        <title id="figT">How iPatent handles your description</title>
        <desc id="figD">Your description (10) is read into a mechanism card (12) stating what the invention is, what it does and how it works. The draft disclosure (14) is written from both. The support map (16) checks each claim element against the numbered paragraphs, and every gap (18) returns to you.</desc>
        <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#131c28"/></marker></defs>
        <g fill="#fff" stroke="#131c28" stroke-width="1.5">
          <rect x="58" y="10" width="226" height="52"/>
          <rect x="58" y="92" width="226" height="98"/>
          <rect x="58" y="220" width="226" height="56"/>
          <rect x="58" y="306" width="226" height="76"/>
        </g>
        <g fill="none" stroke="#131c28" stroke-width="1.5">
          <path d="M171 62V90" marker-end="url(#ah)"/>
          <path d="M171 190V218" marker-end="url(#ah)"/>
          <path d="M171 276V304" marker-end="url(#ah)"/>
          <path d="M58 344H34V36H56" stroke-dasharray="5 4" marker-end="url(#ah)"/>
        </g>
        <g fill="none" stroke="#1d3fc4" stroke-width="1.2">
          <path d="M284 30q16 2 24 -8"/><path d="M284 120q16 2 24 -8"/><path d="M284 242q16 2 24 -8"/><path d="M284 330q16 2 24 -8"/><path d="M34 196q-8 0 -12 -8"/>
        </g>
        <g font-size="14" font-weight="700">
          <text x="312" y="24" style="fill:#1d3fc4">10</text><text x="312" y="114" style="fill:#1d3fc4">12</text><text x="312" y="236" style="fill:#1d3fc4">14</text><text x="312" y="324" style="fill:#1d3fc4">16</text><text x="4" y="184" style="fill:#1d3fc4">18</text>
        </g>
        <g font-size="15" font-weight="700">
          <text x="72" y="33">Your description</text>
          <text x="72" y="116">Mechanism card</text>
          <text x="72" y="244">Draft disclosure</text>
          <text x="72" y="330">Support map</text>
        </g>
        <g font-size="13">
          <text x="72" y="51">in your own words</text>
          <text x="72" y="138">what it is</text><text x="72" y="157">what it does</text><text x="72" y="176">how it works</text>
          <text x="72" y="263">numbered paragraphs and claims</text>
          <text x="72" y="349">each claim element, checked</text>
        </g>
        <g stroke="#131c28" stroke-width="1"><rect x="72" y="360" width="104" height="10" fill="#17734a"/><rect x="176" y="360" width="56" height="10" fill="#9a5b00"/><rect x="232" y="360" width="38" height="10" fill="#b3261e"/></g>
      </svg>
      <figcaption>Fig. 1. Your description (10) is read into a mechanism card (12), and the draft (14) is written from both. The support map (16) checks each claim element against the numbered paragraphs. Gaps (18) return to you: iPatent does not fill them in.</figcaption>
    </figure>
  </section>

  <div class="work">
  ${flowRailHtml()}
  <div class="work-main">
  <section class="form-card" id="draft" aria-labelledby="draftH"><span id="flow-describe" class="flow-a"></span>
    <div class="form-head">
      <h2 id="draftH">Describe the invention</h2>
      <span>Title and description are required. Everything else is optional.</span>
    </div>
    <form id="draftForm">
      <div class="field">
        <label for="title">Title of the invention</label>
        <input id="title" name="title" placeholder="A short, descriptive name for what it is" required>
      </div>
      <div class="field">
        <label for="technicalField">Technical field <span class="opt">(optional)</span></label>
        <input id="technicalField" name="technical_field" placeholder="The area of technology it belongs to" list="fieldOptions" autocomplete="off">
        <datalist id="fieldOptions">
          <option value="Mechanical devices and mechanisms">
          <option value="Consumer products and hardware">
          <option value="Electrical and electronic circuits">
          <option value="Sensors, measurement and instrumentation">
          <option value="Control systems and robotics">
          <option value="Materials, coatings and manufacturing processes">
          <option value="Medical devices">
          <option value="Energy storage and power systems">
          <option value="Thermal management">
          <option value="Vehicles and transport">
          <option value="Chemical processes and compositions">
          <option value="Optics and photonics">
          <option value="Networking and communication">
          <option value="Software and computer-implemented methods">
          <option value="Computing hardware">
        </datalist>
      </div>
      <div class="field">
        <label for="description">Description of the invention</label>
        <p class="hint" id="descHint">Write it for an engineer who has to build it. A claim can only be as strong as the three answers below.</p>
        <dl class="q3">
          <div><dt>What it is</dt><dd>The parts, what each is made of or built from, and how they are arranged and connected.</dd></div>
          <div><dt>What it does</dt><dd>The result it produces, with a measured or expected value where you have one.</dd></div>
          <div><dt>How it works</dt><dd>What each part does to produce that result, and the range of conditions in which it still works.</dd></div>
        </dl>
        <textarea id="description" name="description" aria-describedby="descHint" placeholder="Parts and arrangement. The result. How the parts produce it. Values, alternatives and what each drawing would show." required></textarea>
        <div class="meter" id="meter" aria-live="polite"><div><b>Covered so far: <span id="meterPct">0%</span></b> of what a provisional needs. This check is advisory and never blocks a draft.</div><div class="meter-bar"><div class="meter-fill" id="meterFill" style="width:0%"></div></div><div class="meter-items" id="meterItems"></div></div>
      </div>
      <div class="field" id="mechZone" style="display:none" data-mechanism-first="v2"><span id="flow-mechanism" class="flow-a"></span>
        <h3>Mechanism card</h3>
        <div class="note" style="margin:6px 0 14px">A defensible claim is built on the mechanism, not on the wording. Read the card from your description, correct it, and fill every hole before drafting. Anything marked NOT STATED is not in your description, so a provisional would not protect it.</div>
        <button type="button" id="mechBtn" class="invent">Read the mechanism from my description</button>
        <div id="mechCard" aria-live="polite"></div>
      </div>
      <details class="samples suggest" id="starterZone">
        <summary>Load a sample description, or see similar reference filings</summary>
        <div class="sug-head">Samples <span>from the reference corpus. Pick one to load, then edit it before drafting.</span></div>
        <div class="sug-chips" id="starterChips"><span class="sug-empty">Loading samples&hellip;</span></div>
        <div class="sug-head" id="guideHead" style="display:none">Closest reference filings <span>as you type</span></div>
        <div id="typeGuide" class="guide"><div class="g-empty">As you describe an invention, similar corpus filings will appear here.</div></div>
      </details>
      <div class="row">
        <div class="field">
          <label for="inventorName">Inventor name <span class="opt">(optional, printed on the draft)</span></label>
          <input id="inventorName" name="inventor_name" autocomplete="name">
        </div>
        <div class="field">
          <label for="inventorEmail">Email <span class="opt">(optional, printed on the draft)</span></label>
          <input id="inventorEmail" name="inventor_email" type="email" autocomplete="email">
        </div>
      </div>
      <div class="actions"><span id="flow-draft" class="flow-a"></span>
        <label class="keep"><input type="checkbox" id="keepCopy"> <span>Keep a private copy I can reopen by link. Off by default: unless you tick this, your description and draft are not stored (iPatent only counts drafts by broad topic, never their text).</span></label>
        ${turnstileWidget(null, "ipatent_draft")}
        <div class="actions-row">
          <button type="submit" id="generateBtn">Draft the disclosure</button>
          <button type="button" id="inventBtn" class="invent" title="Load a sample from the reference corpus and draft it">Run a sample draft</button>
        </div>
        <div class="status" id="status" role="status" aria-live="polite"></div>
        <div class="note"><b>Before you file:</b> do not publish, pitch or post the idea. Europe and most other countries have no grace period. <b>Draft only.</b> This is not legal advice; have a registered patent attorney or agent review the draft before filing. Limited to 20 drafts per hour.</div>
      </div>
    </form>
  </section>

  <section id="result" aria-labelledby="resultH">
    <div class="result-head">
      <h2 id="resultH">Draft disclosure, for review</h2>
      <span id="resultId"></span>
    </div>
    <div id="dlBar" style="display:none;gap:10px 16px;flex-wrap:wrap;margin:0 0 16px">
      <button type="button" id="dlHtml" class="invent">Download draft (.html)</button>
      <button type="button" id="dlPrint" class="invent">Print or save as PDF</button>
      <a href="/guide/file-a-us-provisional">How to file it as a US provisional</a>
    </div>
    <div class="close-warn" id="closeWarn" style="display:none"></div>
    <section class="fz" id="smHero" style="display:none" data-flow="v2"><span id="flow-map"></span>
      <div class="fk">Step 4. Support map</div>
      <h2>Is every claim element actually described?</h2>
      <p>A provisional protects only what its description teaches. Each claim element below is checked against the numbered paragraphs of your draft: supported means it is worded there, partly means some of it is, and not described means none of it is.</p>
      <div id="smHeroBody"></div>
    </section>
    <div class="paper">
      <div class="wm">DRAFT</div>
      <div class="pno">United States provisional patent disclosure. Draft for review, not a filed application.</div>
      <div id="resultContent"></div>
      <div class="src" id="ragSources"></div>
    </div>
    <section class="fz" id="fixZone" style="display:none" data-flow="v2"><span id="flow-fix"></span>
      <div class="fk">Step 5. Fix gaps</div>
      <h2>Close the gaps in your own words</h2>
      <p>Each item is a claim element or a mechanism field your description does not yet teach. Write the missing detail (parts, values, how it works, an alternative) and redraft: your answers are added to the description, so the new draft can support them. iPatent never invents the missing detail for you.</p>
      <div id="fixList"></div>
      <div class="btns"><button type="button" id="fixRedraft">Add my answers and redraft</button><button type="button" id="fixSkip" class="invent">Skip to filing</button></div>
      <div class="status" id="fixStatus" role="status" aria-live="polite"></div>
    </section>
    <section class="fz" id="fileZone" style="display:none" data-flow="v2"><span id="flow-file"></span>
      <div class="fk">Step 6. File</div>
      <h2>File it, and put the 12-month date in your calendar</h2>
      <p>A US provisional costs $65 to $325 at the USPTO (by entity size), is never examined and never published, and gives you a filing date for exactly what it describes. Within 12 months you must file the nonprovisional, and any PCT or foreign application, or the date is lost. Disclose nothing in public before you file: most countries outside the US have no grace period.</p>
      <div class="dl-row">
        <div><label for="fileDate">Provisional filing date</label><input type="date" id="fileDate"></div>
        <div><label for="pubDate">First public disclosure (if any)</label><input type="date" id="pubDate"></div>
      </div>
      <div class="deadline" id="deadlineOut" aria-live="polite"></div>
      <div class="btns">
        <button type="button" id="icsBtn">Add the 12-month date to my calendar (.ics)</button>
        <a class="invent" href="/guide/file-a-us-provisional" style="text-align:center;text-decoration:none">Step by step: file at the USPTO</a>
      </div>
      <p class="note" style="margin-top:14px">Dates are computed in your browser; a date on a weekend moves to Monday (35 U.S.C. 21(b)); if it lands on a federal holiday, the next business day applies. Not legal advice: confirm every date with a registered patent attorney or agent.</p>
    </section>
  </section>
  </div>
  </div>

  <div class="after" id="limits">
    <section aria-labelledby="limH">
      <h2 id="limH">What iPatent does not do</h2>
      <ul>
        <li><b>It does not give legal advice.</b> It drafts a disclosure for you and a registered patent attorney or agent to review.</li>
        <li><b>It does not file.</b> Nothing is sent to the USPTO, and generating a draft establishes no filing date.</li>
        <li><b>It does not search the prior art.</b> The closeness warning compares your text with a reference corpus. It is not a novelty or clearance opinion.</li>
        <li><b>It does not supply the invention.</b> A model can state things you never wrote. A grounding check removes figures and citations you did not give, and the support map flags claim elements the text does not teach. The <a href="/example">worked example</a> shows what an unedited run got wrong.</li>
      </ul>
    </section>
    <section aria-labelledby="privH">
      <h2 id="privH">Privacy and method</h2>
      <ul>
        <li><b>Private by default.</b> Your description and draft are not stored unless you ask for a private copy, and nothing is published. Drafts are counted by broad topic, never by their text.</li>
        <li><b>Drafted from your text.</b> Open-weights models on Cloudflare Workers AI write every section from your description and mechanism card. Reference filings contribute section structure only; none of their text is copied into your draft.</li>
        <li><b>You own the result.</b> Download the draft or print it to PDF, then <a href="/guide/file-a-us-provisional">file it at the USPTO yourself</a> for $65 to $325, or take it to a registered practitioner first.</li>
      </ul>
    </section>
  </div>

  <section class="ref" aria-labelledby="refH">
    <h2 id="refH">Filing a provisional yourself</h2>
    <p>Plain-language guides to US provisional applications, written for individual inventors. General information, not legal advice.</p>
    <ul>
      <li><a href="/guide">What a provisional protects, and how to draft one</a></li>
      ${GUIDE_PAGES.map((p) => '<li><a href="/guide/' + p.slug + '">' + escapeHtml(p.title) + "</a></li>").join("")}
      <li><a href="/example">A real AI-drafted provisional, and what it got wrong</a></li>
    </ul>
  </section>

  <section class="sub-box" id="subscribe" aria-labelledby="subH">
    <h2 id="subH">Results from the benchmark</h2>
    <p>We are measuring what AI-drafted provisionals actually secure, on real patents. Get the results and the occasional research note. No spam, one click to leave.</p>
    <form id="subForm" novalidate>
      <label for="subEmail" class="sr">Email address</label>
      <input id="subEmail" type="email" placeholder="you@example.com" autocomplete="email" required>
      <input id="subHp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" class="sr">
      ${turnstileWidget(null, "ipatent_subscribe")}
      <button type="submit" id="subBtn">Subscribe</button>
    </form>
    ${TURNSTILE_SCRIPT}
    <div id="subMsg" role="status" aria-live="polite"></div>
  </section>

  <footer>
    <div class="foot">
      <nav aria-label="Footer">
        <a href="/guide">Provisional guide</a>
        <a href="https://qnfo.org">QNFO</a>
        <a href="https://qnfo.org/papers">Papers</a>
        <a href="https://qnfo.org/legal">License</a>
      </nav>
      <div class="f-legal">
        Built by <b>Rowan Brad Quni-Gudzinas</b> (<a href="https://orcid.org/0009-0002-4317-5604">ORCID</a>) at QNFO, an open research project. Want a human review, iPatent for your team, lab or tech-transfer office, or to collaborate? <a href="https://qnfo.org/work-with-me?utm_source=ipatent&amp;utm_medium=referral&amp;utm_campaign=ipatent">Work with me</a>.<br>
        Share iPatent: ${shareLinks(SHARE_URL, SHARE_TEXT)}
      </div>
      <div class="f-legal">
        iPatent is a free experimental drafting assistant. Outputs are machine-generated drafts: not legal advice, and not filed applications. No USPTO filing date is established by generation. &copy; 2026 QNFO.
      </div>
    </div>
  </footer>
</div>

<script>
(function(){
  const form = document.getElementById('draftForm');
  const btn = document.getElementById('generateBtn');
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  const rc = document.getElementById('resultContent');
  const rag = document.getElementById('ragSources');
  // API base: works from both ipatent.qnfo.org and qnfo.org/ipatent
  const API_BASE = location.pathname.startsWith('/ipatent') ? '/ipatent/api' : '/api';

  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  var lastDoc = null;
  ${FLOW_PAGE_JS}
  // MECHANISM-FIRST-1 v=2 (agent_issues 2053, measured with IPATENT-UI-OVERHAUL-1 #2049): the mechanism card step between
  // describe and draft. Only ?v=2 shows it, so the live page is unchanged until both variants are measured.
  var MECH_V2 = new URLSearchParams(location.search).get('v') === '2';
  var mechFields = null;
  if(MECH_V2){ var mz = document.getElementById('mechZone'); if(mz) mz.style.display = 'block'; }
  // GUIDED-FLOW-1 (agent_issues 2049): the step rail, the support map as the centrepiece, fix gaps, file with the 12-month date.
  var flowState = { describe:false, mechanism:false, draft:false, map:false, fix:false, file:false, gaps:0 };
  function flowPaint(){
    if(!MECH_V2) return;
    var d = (document.getElementById('description') || {}).value || '', t = (document.getElementById('title') || {}).value || '';
    flowState.describe = t.trim().length > 0 && d.trim().length >= 200;
    var order = FLOW_STEPS.map(function(x){ return x[0]; }), active = null;
    order.forEach(function(k){ if(!active && !flowState[k]) active = k; });
    order.forEach(function(k){
      var a = document.querySelector('.flow .fs[data-step="' + k + '"]'); if(!a) return;
      var cls = flowState[k] ? 'done' : (k === active ? 'active' : 'todo');
      if(k === 'map' && flowState.map && flowState.gaps > 0) cls = 'warn';
      a.className = 'fs ' + cls;
      if(k === active) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
      if(k === active){ var rail = document.getElementById('flowRail'); if(rail) rail.scrollLeft = Math.max(0, a.offsetLeft - 24); }
    });
  }
  if(MECH_V2){ document.documentElement.classList.add('v2'); var fr = document.getElementById('flowRail'); if(fr) fr.style.display = 'block'; flowPaint(); }
  function smHeroHtml(sm){
    if(!sm || !sm.rows || !sm.rows.length) return '<p><b>No claim elements to check.</b> The draft has no numbered claims to map; describe the parts and how they work, then redraft.</p>';
    var n = sm.elements || sm.rows.length, pc = function(x){ return n ? (Math.round(x / n * 1000) / 10) : 0; };
    return '<div class="sm-score">' + sm.supported + '<small> of ' + n + ' claim elements supported</small></div>'
      + '<div class="sm-bar" role="img" aria-label="' + sm.supported + ' supported, ' + sm.weak + ' partly, ' + sm.unsupported + ' not supported"><span class="b-s" style="width:' + pc(sm.supported) + '%"></span><span class="b-w" style="width:' + pc(sm.weak) + '%"></span><span class="b-u" style="width:' + pc(sm.unsupported) + '%"></span></div>'
      + '<div class="sm-legend"><span style="color:var(--green)">\u25A0 ' + sm.supported + ' supported</span><span style="color:var(--amber)">\u25A0 ' + sm.weak + ' partly</span><span style="color:var(--danger)">\u25A0 ' + sm.unsupported + ' not described</span></div>'
      + renderSupportMap(sm);
  }
  function gapItems(data){
    var items = [];
    ((data.support_map && data.support_map.rows) || []).forEach(function(r){
      if(r.status === 'supported') return;
      var why = [];
      if(r.missing_terms && r.missing_terms.length) why.push('not in the description: ' + r.missing_terms.join(', '));
      if(r.missing_values && r.missing_values.length) why.push('values not described: ' + r.missing_values.join(', '));
      items.push({ kind: r.status, label: 'Claim ' + r.claim + ' \u2014 ' + (r.status === 'weak' ? 'partly described' : 'not described'), text: r.element, why: why.join('; ') || 'explain how this element is built and what it does' });
    });
    (data.mechanism_holes || []).forEach(function(h){
      var lb = h.field; (mechFields || []).forEach(function(f){ if(f.key === h.field) lb = f.label; });
      items.push({ kind: 'hole', label: 'Mechanism \u2014 ' + lb, text: '', why: h.why });
    });
    return items;
  }
  function renderFix(data){
    var items = gapItems(data), list = document.getElementById('fixList');
    flowState.gaps = items.length;
    if(!list) return;
    if(!items.length){ list.innerHTML = '<p><b>No open gaps.</b> Every claim element is worded in a numbered paragraph. Read the draft once more for accuracy, then file.</p>'; flowState.fix = true; return; }
    list.innerHTML = items.map(function(it, i){
      return '<div class="gap-item ' + it.kind + '"><div class="gl">' + esc(it.label) + '</div>' + (it.text ? '<div class="gw"><b>' + esc(it.text) + '</b></div>' : '') + '<div class="gw" style="color:var(--ink-soft)">' + esc(it.why) + '</div>'
        + '<label for="gap_' + i + '" style="position:absolute;left:-9999px">Your answer for ' + esc(it.label) + '</label><textarea id="gap_' + i + '" data-gap="' + i + '" data-label="' + esc(it.text || it.label) + '" placeholder="The missing detail, in your own words"></textarea></div>';
    }).join('');
  }
  function fileRender(){
    var out = document.getElementById('deadlineOut'); if(!out) return;
    var fd = (document.getElementById('fileDate') || {}).value, pd = (document.getElementById('pubDate') || {}).value;
    var dl = ipDeadline(fd), html = '';
    if(dl) html += 'Nonprovisional and PCT / foreign filing due by<b class="big">' + dl.weekday + ' ' + dl.due + '</b>' + (dl.rolled ? '(12 months fell on a weekend, so the date moves to the next business day.) ' : '') + 'Miss it and the provisional\u2019s filing date is lost.';
    var pdl = ipDeadline(pd);
    if(pdl) html += '<div style="margin-top:10px">You disclosed in public on ' + esc(pd) + ': the US one-year grace period (35 U.S.C. 102(b)(1)) ends <b>' + pdl.due + '</b>. '
      + (fd && fd > pdl.due ? '<b style="color:var(--danger)">Your filing date is after it ends, so your own disclosure is prior art against this application.</b> ' : (fd ? 'Your filing date ' + esc(fd) + ' is inside it, so the US can still except that disclosure. ' : 'File before then. '))
      + 'Most other countries were lost on the day of disclosure.</div>';
    out.innerHTML = html || 'Enter the date you file (or plan to file) the provisional.';
  }
  function todayIso(){ var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  if(MECH_V2){
    var fdi = document.getElementById('fileDate'); if(fdi && !fdi.value) fdi.value = todayIso();
    ['fileDate','pubDate'].forEach(function(id){ var el = document.getElementById(id); if(el) el.addEventListener('input', fileRender); if(el) el.addEventListener('change', fileRender); });
    fileRender();
    document.addEventListener('input', function(ev){ if(ev.target && (ev.target.id === 'description' || ev.target.id === 'title')) flowPaint(); });
  }
  document.addEventListener('click', function(ev){
    var t = ev.target; if(!MECH_V2 || !t) return;
    if(t.id === 'fixRedraft'){
      var adds = [];
      Array.prototype.forEach.call(document.querySelectorAll('#fixList textarea[data-gap]'), function(el){ var v = el.value.trim(); if(v) adds.push(el.getAttribute('data-label') + ': ' + v); });
      var fs = document.getElementById('fixStatus');
      if(!adds.length){ if(fs){ fs.className = 'status err'; fs.textContent = 'Write at least one missing detail first, or skip to filing.'; } return; }
      var de = document.getElementById('description');
      de.value = de.value.replace(/\\s+$/, '') + '\\n\\nFurther detail:\\n' + adds.map(function(a){ return '- ' + a; }).join('\\n');
      updateMeter(); flowState.fix = true; flowPaint();
      if(fs){ fs.className = 'status'; fs.textContent = adds.length + ' answer' + (adds.length > 1 ? 's' : '') + ' added to your description; redrafting\u2026'; }
      if(form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', {cancelable:true}));
    }
    if(t.id === 'fixSkip'){ flowState.fix = true; flowPaint(); var fz = document.getElementById('fileZone'); if(fz) fz.scrollIntoView({behavior:'smooth'}); }
    if(t.id === 'icsBtn'){
      var dl = ipDeadline((document.getElementById('fileDate') || {}).value);
      if(!dl){ fileRender(); return; }
      var blob = new Blob([ipDeadlineIcs(dl.due, (document.getElementById('title') || {}).value)], {type:'text/calendar'});
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ipatent-12-month-deadline-' + dl.due + '.ics';
      document.body.appendChild(a); a.click(); a.remove();
      flowState.file = true; flowPaint();
    }
  });
  function mechHolesHtml(holes){
    if(!holes || !holes.length) return '<div class="smap"><b>No open holes.</b> Every field is stated. Check each one is true, then draft.</div>';
    return '<div class="smap"><b>' + holes.length + ' open hole' + (holes.length > 1 ? 's' : '') + '.</b> Fill these in the card or in your description:' + holes.map(function(h){ var lb = h.field; (mechFields || []).forEach(function(f){ if(f.key === h.field) lb = f.label; }); return '<div style="margin-top:6px;color:#b3261e"><b>' + esc(lb) + '</b> &mdash; ' + esc(h.why) + '</div>'; }).join('') + '</div>';
  }
  function renderMech(data){
    mechFields = data.fields || [];
    var box = document.getElementById('mechCard');
    if(!box) return;
    box.innerHTML = mechFields.map(function(f){
      var v = (data.mechanism && data.mechanism[f.key]) || 'NOT STATED';
      var hole = v === 'NOT STATED';
      return '<div style="margin-top:12px"><label for="mech_' + f.key + '" style="' + (hole ? 'color:#b3261e' : '') + '">' + esc(f.label) + (hole ? ' &mdash; NOT STATED' : '') + '</label>'
        + '<div style="font-size:12px;color:var(--ink-soft);margin:2px 0 4px">' + esc(f.asks) + '</div>'
        + '<textarea id="mech_' + f.key + '" data-mech="' + f.key + '" rows="2" style="min-height:0;height:64px">' + esc(hole ? '' : v) + '</textarea></div>';
    }).join('') + mechHolesHtml(data.holes);
  }
  function mechCardValue(){
    if(!MECH_V2 || !mechFields) return null;
    var out = {}, any = false;
    mechFields.forEach(function(f){ var el = document.getElementById('mech_' + f.key); var v = el ? el.value.trim() : ''; out[f.key] = v || 'NOT STATED'; if(v) any = true; });
    return any ? out : null;
  }
  document.addEventListener('click', function(ev){
    if(!ev.target || ev.target.id !== 'mechBtn') return;
    var b = ev.target, box = document.getElementById('mechCard');
    b.disabled = true; b.textContent = 'Reading the mechanism\u2026';
    fetch(API_BASE + '/mechanism', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
      title: document.getElementById('title').value.trim(),
      technical_field: document.getElementById('technicalField').value.trim(),
      description: document.getElementById('description').value.trim()
    })}).then(function(r){ return r.json().then(function(j){ return {s:r.status, j:j}; }, function(){ return {s:r.status, j:null}; }); })
      .then(function(res){
        if(res.s === 200 && res.j && res.j.mechanism){ renderMech(res.j); flowState.mechanism = true; flowPaint(); }
        else if(box) box.innerHTML = '<div class="status err">' + esc((res.j && res.j.error) || 'Could not read the mechanism. Please try again.') + '</div>';
      })
      .catch(function(){ if(box) box.innerHTML = '<div class="status err">Network error. Please try again.</div>'; })
      .then(function(){ b.disabled = false; b.textContent = 'Read the mechanism again'; });
  });
  // COMPLETENESS-METER-1: what a provisional needs, checked as you type. Advisory only; it never blocks drafting.
  var METER = [
    ['problem', 'Problem solved', /\\b(problem|limitation|drawback|existing|conventional|currently|fails?|inefficien|costly|slow)\\b/i],
    ['parts', 'Parts named', /\\b(comprises?|includes?|consists?|component|module|unit|layer|circuit|sensor|housing|controller|processor|chamber|assembly)\\b/i],
    ['how', 'How it works', /\\b(configured to|so that|causes?|in order to|operat\\w*|which then|by (\\w+ing))\\b/i],
    ['numbers', 'Concrete values', /\\d+(\\.\\d+)?\\s?(nm|um|\u00b5m|mm|cm|m|kg|g|mg|\u00b0c|k|hz|khz|mhz|ghz|v|mv|a|ma|w|kw|%|ms|s|min|rpm|bar|psi|ppm)\\b/i],
    ['variants', 'Alternatives', /\\b(alternativ\\w*|instead|variant|optionally|another embodiment|in some embodiments|may also|could also)\\b/i],
    ['figures', 'Figures described', /\\b(fig(ure)?\\.?\\s?\\d|drawing|diagram|sketch|schematic|flowchart)\\b/i],
    ['length', 'Enough detail (600+ chars)', null]
  ];
  function updateMeter(){
    var d = (document.getElementById('description') || {}).value || '';
    var hits = METER.map(function(m){ return m[2] ? m[2].test(d) : d.trim().length >= 600; });
    var n = hits.filter(Boolean).length, pct = Math.round(n / METER.length * 100);
    var f = document.getElementById('meterFill'); if(f) f.style.width = pct + '%';
    var pc = document.getElementById('meterPct'); if(pc) pc.textContent = pct + '%';
    var it = document.getElementById('meterItems');
    if(it) it.innerHTML = METER.map(function(m, i){ return '<span class="mi ' + (hits[i] ? 'ok' : 'no') + '">' + m[1] + '</span>'; }).join('');
  }
  document.addEventListener('input', function(ev){ if(ev.target && ev.target.id === 'description') updateMeter(); });
  setTimeout(updateMeter, 0);
  function pnum(n){ return '[' + String(n).padStart(4, '0') + ']'; }
  function renderSupportMap(sm){
    if(!sm || !sm.rows || !sm.rows.length) return '';
    var head = '<b>Support map.</b> ' + sm.supported + ' of ' + sm.elements + ' claim elements are worded in a numbered paragraph, ' + sm.weak + ' partly, ' + sm.unsupported + ' not at all. Fix the red ones in your description before filing. <span class="sm-meta">(' + esc(sm.method) + ')</span>';
    var rows = sm.rows.map(function(r){
      return '<div class="sm-row ' + r.status + '"><div>Cl. ' + r.claim + '</div><div><div class="sm-el">' + esc(r.element) + '</div><div class="sm-meta"><span class="sm-st">' + r.status.toUpperCase() + ' ' + Math.round(r.coverage * 100) + '%</span> \u00b7 best ' + (r.paragraph ? pnum(r.paragraph) : 'none') + ((r.missing_values && r.missing_values.length) ? ' \u00b7 values not in the description: ' + esc(r.missing_values.join(', ')) : '') + ((r.missing_terms && r.missing_terms.length) ? ' \u00b7 not found: ' + esc(r.missing_terms.join(', ')) : '') + '</div></div></div>';
    }).join('');
    return '<div class="smap">' + head + rows + '</div>';
  }
  function downloadDoc(){
    if(!lastDoc || !lastDoc.html) return;
    var blob = new Blob([lastDoc.html], {type:'text/html'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'provisional-disclosure-' + lastDoc.id + '.html';
    document.body.appendChild(a); a.click(); a.remove();
  }
  var sf = document.getElementById('subForm');
  if(sf) sf.addEventListener('submit', function(e){
    e.preventDefault();
    var em = (document.getElementById('subEmail').value || '').trim(), hp = (document.getElementById('subHp') || {}).value || '';
    var m = document.getElementById('subMsg'), b = document.getElementById('subBtn');
    if(!em || em.indexOf('@') < 1){ m.textContent = 'Please enter a valid email address.'; return; }
    b.disabled = true; m.textContent = 'Subscribing\u2026';
    fetch(API_BASE + '/subscribe', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email: em, hp: hp, cf_turnstile: (sf.querySelector('[name=cf-turnstile-response]') || {}).value || ''})})
      .then(function(r){ return r.json().then(function(j){ return {s:r.status, j:j}; }); })
      .then(function(res){ m.textContent = (res.s === 200 && res.j.ok) ? 'Thanks \u2014 check your inbox to confirm.' : ((res.j && res.j.error) || 'Something went wrong. Please try again.'); if(res.s === 200) sf.reset(); })
      .catch(function(){ m.textContent = 'Network error. Please try again.'; })
      .then(function(){ b.disabled = false; try{ if(window.turnstile) turnstile.reset(sf.querySelector('.cf-turnstile')); }catch(_){} });
  });
  document.addEventListener('click', function(ev){
    var t = ev.target;
    if(t && t.id === 'dlHtml') downloadDoc();
    if(t && t.id === 'dlPrint') window.print();
  });

  function renderSections(s, paras){
    paras = paras || [];
    var numbered = function(key){ return paras.filter(function(p){ return p.key === key; }).map(function(p){ return '<p class="para"><span class="pn">' + pnum(p.n) + '</span>' + esc(p.text) + '</p>'; }).join(''); };
    const blocks = [
      ['1. TITLE OF INVENTION', s.title],
      ['2. TECHNICAL FIELD', s.technical_field],
      ['3. BACKGROUND', s.background],
      ['4. SUMMARY OF THE INVENTION', s.summary],
      ['5. DETAILED DESCRIPTION', s.detailed_description],
      ['6. CLAIMS', s.claims],
      ['7. ABSTRACT', s.abstract],
      ['8. INVENTOR DECLARATION', s.declaration],
      ['REVIEWER NOTES \u2014 SUPPORT GAPS (REMOVE BEFORE FILING)', s.support_gaps]
    ];
    return blocks.filter(([,v])=>v).map(([h,v])=>{
      if(h.startsWith('6.')){
        const claims = String(v).split(/\\n/).filter(l=>l.trim()).map(l=>'<div class="claim">'+esc(l)+'</div>').join('');
        return '<h3>'+h+'</h3><div>'+claims+'</div>';
      }
      var keyOf = {'2.':'technical_field','3.':'background','4.':'summary','5.':'detailed_description'}[h.slice(0,2)];
      var nb = keyOf ? numbered(keyOf) : '';
      if(nb) return '<h3>'+h+'</h3><div>'+nb+'</div>';
      return '<h3>'+h+'</h3><div class="sec">'+esc(v)+'</div>';
    }).join('');
  }

  function renderRag(sources){
    if(!sources || !sources.length) return '<b>Reference filings:</b> none matched.';
    const rows = sources.slice(0,6).map(s=>
      '<div class="src-row"><b>'+esc(s.title)+'</b>, similarity '+ (s.score*100).toFixed(0)+'%, section: '+esc(s.section)+'</div>'
    ).join('');
    return '<b>Reference filings matched (used for section structure only):</b>'+rows;
  }

  // ==== Adaptive starters + type-ahead corpus guidance (v3.4) ====
  function loadStarters(){
    fetch(API_BASE + '/suggest').then(function(r){return r.json();}).then(function(d){
      var zone = document.getElementById('starterChips');
      if(!zone) return;
      var ex = (d && d.examples) || [];
      zone.innerHTML = '';
      if(!ex.length){ zone.innerHTML = '<span class="sug-empty">No corpus examples yet.</span>'; return; }
      ex.forEach(function(m){
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sug-chip';
        var t = m.title || 'Example';
        b.textContent = t.length > 60 ? t.slice(0,60) + '...' : t;
        var tf = m.field_clean || m.technical_field || '';
        b.title = (tf ? tf + ' / ' : '') + (m.focus || '');
        b.addEventListener('click', function(){ applyExample(m.i); });
        zone.appendChild(b);
      });
    }).catch(function(){});
  }
  function applyExample(i){
    fetch(API_BASE + '/idea?i=' + encodeURIComponent(i)).then(function(r){return r.json();}).then(function(idea){
      if(!idea || !idea.title) throw new Error('no idea returned');
      document.getElementById('title').value = idea.title || '';
      document.getElementById('technicalField').value = idea.field_clean || idea.technical_field || '';
      document.getElementById('description').value = idea.description || '';
      var st = document.getElementById('status');
      if(st){ st.className = 'status'; st.textContent = 'Sample loaded. Edit it before drafting.'; updateMeter(); flowPaint(); }
    }).catch(function(err){
      var st = document.getElementById('status');
      if(st){ st.className = 'status err'; st.textContent = 'Could not load example: ' + err.message; }
    });
  }
  var guideTimer = null;
  function loadGuidance(){
    var t = (document.getElementById('title').value || '').trim();
    var d = (document.getElementById('description').value || '').trim();
    var f = (document.getElementById('technicalField').value || '').trim();
    var q = (f ? f + ' ' : '') + (t ? t + ' ' : '') + d;
    var box = document.getElementById('typeGuide');
    if(!box) return;
    if(q.length < 3){ box.innerHTML = '<div class="g-empty">As you describe an invention, similar corpus filings will appear here.</div>'; return; }
    fetch(API_BASE + '/suggest?q=' + encodeURIComponent(q.slice(0,300))).then(function(r){return r.json();}).then(function(d2){
      var sim = (d2 && d2.similar) || [];
      var head = document.getElementById('guideHead');
      if(head) head.style.display = sim.length ? '' : 'none';
      if(!sim.length){ box.innerHTML = '<div class="g-empty">No close corpus filings matched yet - keep adding detail.</div>'; return; }
      var h = '';
      sim.slice(0,4).forEach(function(m){
        var pct = Math.round((Number(m.score) || 0) * 100);
        var sec = m.section ? ' / ' + m.section : '';
        h += '<div class="g-row"><span class="g-t"><b>' + esc(m.title || '') + '</b>' + esc(sec) + ' <span class="g-pct">' + pct + '%</span></span></div>';
      });
      box.innerHTML = h + '<div class="g-note">Corpus filings are style references - drafts are written fresh from your description.</div>';
    }).catch(function(){});
  }
  ['title','description','technicalField'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener('input', function(){ if(guideTimer) clearTimeout(guideTimer); guideTimer = setTimeout(loadGuidance, 400); });
  });
  // The friendly failure: the form keeps everything the visitor typed, and Retry resubmits the same input.
  function showRetry(){
    status.className = 'status err';
    status.textContent = 'The drafting model did not answer in time. Your text is still here; try again in a minute. ';
    var rb = document.createElement('button');
    rb.type = 'button';
    rb.id = 'retryBtn';
    rb.textContent = 'Retry';
    rb.className = 'invent'; rb.style.cssText = 'margin-left:8px;padding:4px 14px;font-size:15px';
    rb.addEventListener('click', function(){
      if(form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', {cancelable:true}));
    });
    status.appendChild(rb);
  }
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Drafting\u2026 this can take up to 90 seconds';
    status.textContent = '';
    status.className = 'status';
    result.style.display = 'none';
    try{
      const resp = await fetch(API_BASE + '/draft', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          title: document.getElementById('title').value.trim(),
          technical_field: document.getElementById('technicalField').value.trim(),
          description: document.getElementById('description').value.trim(),
          inventor_name: document.getElementById('inventorName').value.trim(),
          inventor_email: document.getElementById('inventorEmail').value.trim(),
          save: !!(document.getElementById('keepCopy') && document.getElementById('keepCopy').checked),
          mechanism: mechCardValue(),
          cf_turnstile: (form.querySelector('[name=cf-turnstile-response]') || {}).value || '',
          variant: MECH_V2 ? 'v2' : undefined
        })
      });
      // IPATENT-ERROR-JSON-1: an edge 502/504 arrives as text/plain ('upstream request failed'); read text first and parse
      // JSON only when the server says it is JSON, so a slow model never surfaces as 'Unexpected token u'.
      const raw = await resp.text();
      let data = null;
      if(/json/i.test(resp.headers.get('content-type') || '')){ try{ data = JSON.parse(raw); }catch(_){ data = null; } }
      if(!resp.ok || !data){
        if(resp.status >= 400 && resp.status < 500 && data && data.error){
          status.className = 'status err';
          status.textContent = 'Error: ' + data.error;
        } else {
          showRetry();
        }
        return;
      }
      result.style.display = 'block';
      document.getElementById('resultId').textContent = 'Draft ' + data.submission_id;
      if(MECH_V2){
        var smh = document.getElementById('smHero'), smb = document.getElementById('smHeroBody');
        if(smb) smb.innerHTML = smHeroHtml(data.support_map);
        if(smh) smh.style.display = 'block';
        renderFix(data);
        ['fixZone','fileZone'].forEach(function(id){ var z = document.getElementById(id); if(z) z.style.display = 'block'; });
        flowState.draft = true; flowState.map = true; fileRender(); flowPaint();
      }
      rc.innerHTML = renderSections(data.sections||{}, data.paragraphs||[]) + (MECH_V2 ? '' : renderSupportMap(data.support_map)) + (data.mechanism ? '<div class="smap"><b>Mechanism card used.</b> The claims were derived from your card.</div>' + mechHolesHtml(data.mechanism_holes) : '') + '<div class="smap"><b>Next.</b> Fix every element marked not described in your own words, add the figures, then have a registered practitioner review it. Want a human review or iPatent for your team? <a href="https://qnfo.org/work-with-me?utm_source=ipatent&amp;utm_medium=referral&amp;utm_campaign=ipatent-result">Work with me</a>.</div>';
      rag.innerHTML = renderRag(data.rag_sources||[]);
      var cw = document.getElementById('closeWarn');
      if(cw){
        if(data.prior_art && data.prior_art.flag){
          cw.style.display = 'block';
          cw.innerHTML = '<b>Closeness warning.</b> Your description is very close to &ldquo;' + esc(data.prior_art.top_title || '') + '&rdquo; (' + Math.round((Number(data.prior_art.top_score) || 0) * 100) + '% similar, section ' + esc(data.prior_art.section || 'n/a') + '). ' + esc(data.prior_art.message || 'Refine the distinguishing features before filing.') + ' This is a style/prior-art reference, not a clearance opinion.';
        } else { cw.style.display = 'none'; }
      }
      lastDoc = { html: data.document_html || '', id: data.submission_id };
      var dl = document.getElementById('dlBar');
      if(dl) dl.style.display = 'flex';
      status.textContent = data.saved
        ? 'Draft ready. A private copy is kept; reopen it at ' + data.private_link
        : 'Draft ready. It is not stored: download or print it now.';
      document.getElementById(MECH_V2 ? 'smHero' : 'result').scrollIntoView({behavior:'smooth'});
    }catch(err){
      showRetry();
    }finally{
      btn.disabled = false;
      btn.textContent = 'Draft the disclosure';
      try{ if(window.turnstile) turnstile.reset(form.querySelector('.cf-turnstile')); }catch(_){}
      const ib = document.getElementById('inventBtn');
      if(ib){ ib.disabled = false; ib.textContent = 'Run a sample draft'; }
    }
  });

  // ==== "Invent Something" (I'm Feeling Lucky) \u2014 pick a real corpus concept + auto-draft ====
  document.getElementById('inventBtn').addEventListener('click', async ()=>{
    const inventBtn = document.getElementById('inventBtn');
    inventBtn.disabled = true;
    inventBtn.textContent = 'Loading a sample\u2026';
    status.textContent = 'Loading a sample from the reference corpus\u2026';
    status.className = 'status';
    try{
      const resp = await fetch(API_BASE + '/idea');
      const idea = await resp.json();
      if(!resp.ok || !idea.title) throw new Error(idea.error || ('HTTP ' + resp.status));
      document.getElementById('title').value = idea.title;
      document.getElementById('technicalField').value = idea.field_clean || idea.technical_field || '';
      document.getElementById('description').value = idea.description;
      status.textContent = 'Sample loaded: "' + idea.title.slice(0,60) + '". Drafting\u2026';
      form.dispatchEvent(new Event('submit', {cancelable:true}));
    }catch(err){
      status.className = 'status err';
      status.textContent = 'Error: ' + err.message;
      inventBtn.disabled = false;
      inventBtn.textContent = 'Run a sample draft';
    }
  });
  loadStarters();
})();
<\/script>
${fleetCtlLink(CANONICAL_ORIGIN + "/")}
</body>
</html>
`;
var qnfo_ipatent_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname;
    // CANONICAL-HOST-1 (3.5.0): qnfo.org/ipatent served a duplicate of the app (200, no canonical). Pages now 301 to
    // the subdomain; the /ipatent/api/* paths keep answering so an already-open page still works.
    if (path === "/ipatent" || path.startsWith("/ipatent/")) {
      const rest = path.slice("/ipatent".length) || "/";
      const isApi = rest.startsWith("/api/");
      if (url.hostname !== "ipatent.qnfo.org" && !isApi && (request.method === "GET" || request.method === "HEAD")) {
        return new Response(null, { status: 301, headers: { Location: CANONICAL_ORIGIN + rest + url.search } });
      }
      path = rest;
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      if (path === "/health") {
        if (ctx && ctx.waitUntil) ctx.waitUntil(turnstileSelfTest(env)); // TURNSTILE-SELFTEST-1: at most one siteverify self-test an hour
        return json({
          status: "ok",
          worker: "qnfo-ipatent",
          version: VERSION,
          capabilities: ["disclosure-drafting", "prior-art-search", "private-saved-draft", "provisional-guide", "page-metrics", "usage-topics", "support-map", "completeness-meter", "guided-flow-v2", "ab-split-v2", "subscribe", "llms-txt", "cost-per-draft"],
          limitations: ["POST /api/draft allows 20 submissions per IP per hour", "each human page load of / is drawn at random onto the default page or the ?v=2 guided flow, with no cookie (share = ops_config ipatent_v2_share, 0 turns it off) so both variants can be measured per page view (AB-SPLIT-V2-1, BP26-NO-TRACKING-1)", "drafts are invention disclosures for review, not filed patents", "nothing is stored unless the inventor opts in; /api/disclosures needs X-Admin-Token", "searches and drafts are counted per day by broad topic only (usage_counts); their text is never stored (IPATENT-USAGE-1)", "page metrics are daily counts by source class only (no IP, user agent or cookie); crawler detection is a user-agent heuristic", "the support map is a lexical check of claim wording against numbered paragraphs, not a legal opinion", "at most 150 drafts in 24 hours across all users"],
          bindings: {
            d1: !!env.IPATENT_DB ? "ipatent-db" : null,
            r2: !!env.IPATENT_R2 ? "ipatent" : null,
            vz: !!env.DISCLOSURES_VZ ? "ipatent-corpus" : null,
            ai: !!env.AI
          }
        });
      }
      const isRead = request.method === "GET" || request.method === "HEAD";
      if (path === "/" && isRead) {
        // GUIDED-FLOW-1: the ?v=2 variant is counted under its own path so the two variants can be compared (#2049 step 2).
        const ab = await abArm(request, url, env);
        if (ab && ab.redirect) {
          const rh = corsHeaders({ "Location": ab.redirect, "Cache-Control": "no-store" });
          if (ab.cookie) rh["Set-Cookie"] = ab.cookie;
          return new Response(null, { status: 302, headers: rh });
        }
        if (request.method === "GET") ctx?.waitUntil?.(countPageView(env, url.searchParams.get("v") === "2" ? "/?v=2" : "/", pageSource(request)));
        const page = html(LANDING_HTML);
        if (ab) { page.headers.set("Cache-Control", "no-store"); if (ab.cookie) page.headers.set("Set-Cookie", ab.cookie); }
        return page;
      }
      if ((path === "/example" || path === "/example/") && isRead) {
        if (request.method === "GET") ctx?.waitUntil?.(countPageView(env, "/example", pageSource(request)));
        return html(renderExamplePage());
      }
      if (path === "/og.jpg" && isRead) {
        const bin = Uint8Array.from(atob(OG_JPEG_B64), (c) => c.charCodeAt(0));
        return new Response(bin, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
      }
      if (path.startsWith("/guide/") && path.length > 7 && isRead) {
        const gslug = path.slice(7).replace(/\/+$/, "");
        const gpage = GUIDE_PAGES.find((x) => x.slug === gslug);
        if (!gpage) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        if (request.method === "GET") ctx?.waitUntil?.(countPageView(env, "/guide/" + gslug, pageSource(request)));
        return html(renderGuidePage(gpage));
      }
      if ((path === "/guide" || path === "/guide/") && isRead) {
        if (request.method === "GET") ctx?.waitUntil?.(countPageView(env, "/guide", pageSource(request)));
        return html(GUIDE_HTML);
      }
      if (path === "/api/metrics" && request.method === "GET") return handleMetrics(env);
      if (path === "/api/subscribe" && request.method === "POST") return handleSubscribe(request, env);
      // BENCH-SOURCE-PROBE-1 (3.9.5, #1779): can the fleet read issued-patent text server-side without a USPTO key? Fetches ONE
      // fixed public Google Patents page and reports only status, size and whether claims and a provisional reference were found.
      // Edge-cached 1 h, so it cannot be used to hammer the source; no user input reaches the URL.
      if (path === "/api/benchmark/source-probe" && isRead) return benchSourceProbe(request, ctx);
      if (path === "/api/benchmark/dataset" && (request.method === "GET" || request.method === "POST")) return benchDataset(request, env);
      if (path === "/llms.txt" && isRead) return new Response(LLMS_TXT, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
      if (path === "/" + INDEXNOW_KEY + ".txt" && isRead) return new Response(INDEXNOW_KEY, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      if (path === "/robots.txt" && isRead) {
        return new Response("User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /d/\nSitemap: " + CANONICAL_ORIGIN + "/sitemap.xml\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      if (path === "/sitemap.xml" && isRead) {
        const urls = ["/", "/guide", "/example"].concat(GUIDE_PAGES.map((x) => "/guide/" + x.slug)).map((p) => "<url><loc>" + CANONICAL_ORIGIN + p + "</loc><lastmod>" + GUIDE_UPDATED + "</lastmod></url>").join("");
        return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + "</urlset>", { headers: { "Content-Type": "application/xml; charset=utf-8" } });
      }
      if (path.startsWith("/d/") && isRead) {
        const row = await env.IPATENT_DB.prepare("SELECT document_html, title FROM submissions WHERE submission_id = ?1").bind(path.slice(3)).first();
        if (!row || row.title === "[private]" || !row.document_html) return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
        return new Response(row.document_html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "private, no-store" } });
      }
      if (path === "/api/draft" && request.method === "POST") return handleDraft(request, env, ctx);
      if (path === "/api/mechanism" && request.method === "POST") return handleMechanism(request, env, ctx);
      if (path === "/api/search" && request.method === "GET") {
        ctx?.waitUntil?.(countUsage(env, "search", url.searchParams.get("q") || url.searchParams.get("query") || "", request.headers.get("User-Agent") || ""));
        return handleSearch(env, url);
      }
      // DISCLOSURE-LIST-CLOSED-1 (3.5.0): listing inventors' submissions publicly is a pre-filing disclosure risk.
      if (path === "/api/disclosures" && request.method === "GET") {
        if (!adminOk(request, env)) return json({ error: "Not found" }, 404);
        return handleDisclosures(env, url);
      }
      if (path.startsWith("/api/submission/") && request.method === "GET") {
        const id = path.split("/api/submission/")[1];
        if (!id) return json({ error: "Missing submission ID" }, 400);
        return handleSubmission(env, id);
      }
      if (path === "/api/idea" && request.method === "GET") {
        const iParam = url.searchParams.get("i");
        let idea;
        if (iParam !== null && iParam !== "") {
          const idx = parseInt(iParam, 10);
          if (!Number.isFinite(idx) || idx < 0 || idx >= (Array.isArray(IDEA_BANK) ? IDEA_BANK.length : 0)) return json({ error: "No such example index" }, 404);
          idea = IDEA_BANK[idx];
        } else {
          idea = IDEA_BANK[Math.floor(Math.random() * IDEA_BANK.length)] || IDEA_BANK[0];
        }
        if (!idea) return json({ error: "No idea bank entries" }, 404);
        return json(decorateIdea(idea));
      }
      if (path === "/api/suggest" && request.method === "GET") return handleSuggest(env, url);
      if (path === "/api/status" && request.method === "GET") return handleStatus(env);
      if (path === "/api/cost" && request.method === "GET") return handleCost(env);
      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Unhandled error:", err.message, err.stack);
      return json({ error: "Internal server error" }, 500);
    }
  }
};
export {
  qnfo_ipatent_default as default,
  abArm,
  abShare
};
//# sourceMappingURL=worker.js.map

// ---- WEBMCP-FLEET-1:BEGIN (sourced from _shared/webmcp.js; applied by scripts/webmcp-apply.mjs; do not edit inside a worker) ----
// WEBMCP-FLEET-1 (2026-10-25, pillar reach, owner directive "implement WebMCP systemwide across the fleet").
//
// WHAT. WebMCP (https://blog.cloudflare.com/webmcp/, August 2026) is a browser standard, shipping experimentally in
// Chrome 146, that appears in the page as document.modelContext: a site registers MCP tools with registerTool() so an
// agent visiting the page can call the site's own operations instead of guessing its way through a page built for
// humans. Cloudflare's developer preview offers a zone toggle that injects a bridge and two packs (c2pa, and a proxy
// to the site's own MCP server). That toggle is Dashboard-only and this fleet's token may not write zone Snippets
// (probed 2026-10-25: HTTP 403 "snippets are not allowed", and GET /user/tokens 403 so no wider token can be minted),
// so the fleet carries its own implementation, which is also the only version that can expose QNFO's real operations.
//
// HOW. Three pieces, all same-origin, all served by the worker that already answers the page:
//   1. GET /.webmcp/bridge.js   the browser-side module: finds document.modelContext, reads the manifest, registers
//                               every tool, and returns without registering anything when the browser has no WebMCP.
//   2. GET /.webmcp/packs.json  the machine-readable manifest (also readable by a non-browser agent).
//   3. an HTMLRewriter step on 200 HTML responses appending one <script type="module" src="/.webmcp/bridge.js">.
//
// WHY same-origin only. The bridge runs in the visitor's page with the visitor's session. A tool that reached another
// origin would hand this origin's tools to a page we do not own, and a proxy that took a caller-supplied absolute URL
// would be an SSRF surface on every page of every host. Every request template below is a path, resolved against the
// page's own origin, and read_page refuses anything that is not a path on this origin.
//
// WHY this is not a false capability claim (DECLARED-NOT-WORKING-1). The manifest is generated from the same table the
// bridge registers from, and every endpoint in it was answered 200 by a live probe on 2026-10-25 before shipping. The
// bridge reports what actually happened in window.__webmcp: supported=false when the browser has no modelContext, and
// registered=<n> only after registerTool() returned. Measured 2026-10-25 before this shipped: ideas /api/proposals
// answered 503 and was REMOVED from the manifest rather than advertised; ideas /api/sessions, q08 /api/metrics and
// POST ask.qwav.tech/api/ask answered 200. scripts/webmcp-verify.mjs re-probes every host and every tool endpoint.
//
// ROLLBACK. Revert the deploy of a worker to its previous version; the block is inert code for a browser without
// modelContext and cannot change a page's rendered output for any other client.
var WM_VERSION = "1.2.0";
var WM_BRIDGE_PATH = "/.webmcp/bridge.js";
var WM_PACKS_PATH = "/.webmcp/packs.json";
var WM_MANIFEST_PATH = "/.webmcp/manifest.json";
// WM_MANIFEST_URL is the path the bridge reads, and it is deliberately OUTSIDE /.webmcp/: Cloudflare's own WebMCP
// preview owns that prefix at the edge when a zone has it switched on (measured 2026-10-25: /.webmcp/bridge.js answer
// 75,756 bytes of the platform bundle and /.webmcp/packs.json answer 404 without ever reaching the worker), so a
// manifest under that prefix is invisible on exactly the zone with the most traffic. /api/webmcp/ is ours end to end.
var WM_MANIFEST_URL = "/api/webmcp/manifest.json";
var WM_MCP_PATH = "/mcp";
var WM_MCP_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];
var WM_MAX_TEXT = 40000;

// WM_PACK_DEFS: the whole tool surface. `request` is a same-origin template. `{name}` in a path or a query value is
// replaced from the call arguments; an argument that is absent drops its query key rather than sending "undefined".
var WM_PACK_DEFS = {
  site: {
    title: "This site",
    description: "Read the site the visitor is looking at: the page in front of them, any page on this origin, and the sitemap.",
    tools: [
      {
        name: "get_page_context",
        description: "Return the page the visitor is on: its URL, title, description, its section headings and any text the visitor has selected. Call this first to learn where you are.",
        inputSchema: { type: "object", properties: {} },
        local: "page_context"
      },
      {
        name: "read_page",
        description: "Fetch a path on this site and return its text (HTML reduced to readable text, or the raw body for JSON/Markdown/plain). Paths are relative to this origin.",
        inputSchema: { type: "object", properties: { path: { type: "string", description: "A path on this site, e.g. /about" }, max_chars: { type: "number", description: "Truncate the text to this many characters (default 20000)" } }, required: ["path"] },
        request: { method: "GET", path: "{path}" }
      },
      {
        name: "list_site_pages",
        description: "List the URLs published in this site's sitemap.xml.",
        inputSchema: { type: "object", properties: { limit: { type: "number", description: "Maximum URLs to return (default 100)" } } },
        request: { method: "GET", path: "/sitemap.xml", extract: "loc" }
      }
    ]
  },
  papers: {
    title: "QNFO living papers",
    description: "Search, read and question the QNFO research corpus: full texts as Markdown, a JSON metadata API, and a deterministic digest of any paper.",
    tools: [
      {
        name: "search_papers",
        description: "Full-text search over the QNFO papers corpus. Returns matching papers with slug, title, authors and abstract.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "Search words" }, limit: { type: "number", description: "1-50, default 10" } }, required: ["q"] },
        request: { method: "GET", path: "/api/papers", query: { q: "{q}", limit: "{limit}" } }
      },
      {
        name: "get_paper",
        description: "Metadata for one paper by slug: title, authors, abstract, DOI, version, dates, licence and the URLs of its Markdown and PDF.",
        inputSchema: { type: "object", properties: { slug: { type: "string", description: "Paper slug, e.g. ultrametric-intelligence" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/papers/{slug}" }
      },
      {
        name: "get_paper_markdown",
        description: "The full text of one paper as Markdown. Use this to read or quote a paper.",
        inputSchema: { type: "object", properties: { slug: { type: "string" }, max_chars: { type: "number" } }, required: ["slug"] },
        request: { method: "GET", path: "/papers/{slug}.md", accept: "text/markdown" }
      },
      {
        name: "get_paper_digest",
        description: "A deterministic digest of one paper written from its own sentences: the abstract, the claim, the figures it reports, how it is done, what would falsify it, where the claim stops, and a map of where to read.",
        inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
        request: { method: "GET", path: "/api/quickread/{slug}" }
      }
    ]
  },
  fleet: {
    title: "QNFO fleet",
    description: "The live state of the QNFO Cloudflare fleet: health, spend, what needs attention and what changed.",
    tools: [
      {
        name: "fleet_status",
        description: "Fleet verdict and what the fleet is waiting on a human to do.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/human" }
      },
      {
        name: "fleet_attention",
        description: "Everything the fleet currently flags as needing attention.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/attention" }
      },
      {
        name: "fleet_cost",
        description: "Cost per surface over the current windows.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/cost" }
      },
      {
        name: "fleet_areas",
        description: "The functional areas of the fleet with their state.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/areas" }
      }
    ]
  },
  ideas: {
    title: "QNFO ideas",
    description: "The QNFO idea hub: the open idea threads.",
    tools: [
      {
        name: "list_ideas",
        description: "List the open idea threads in the hub.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/sessions" }
      }
    ]
  },
  signals: {
    title: "q08 signal organism",
    description: "Signals, forecasts and run metrics of the q08 signal organism.",
    tools: [
      {
        name: "list_signals",
        description: "The latest signals emitted by the organism.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/signals" }
      },
      {
        name: "list_forecasts",
        description: "Open and resolved forecasts with their outcomes.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/forecasts" }
      },
      {
        name: "signal_metrics",
        description: "Organism run metrics.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/metrics" }
      }
    ]
  },
  ask: {
    title: "Ask QWAV",
    description: "Ask a question over the QNFO corpus and read recent questions.",
    tools: [
      {
        name: "ask_corpus",
        description: "Ask a research question and get an answer grounded in the QNFO corpus with its sources.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "The question" } }, required: ["q"] },
        request: { method: "POST", path: "/api/ask", body: { q: "{q}" } }
      },
      {
        name: "recent_questions",
        description: "Recently asked questions and their answers.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/recent" }
      },
      {
        name: "corpus_stats",
        description: "Index statistics for the corpus behind this search.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/stats" }
      }
    ]
  },
  ipatent: {
    title: "iPatent",
    description: "Search the disclosure corpus, read its status, and get invention suggestions.",
    tools: [
      {
        name: "search_disclosures",
        description: "Search the iPatent disclosure corpus.",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        request: { method: "GET", path: "/api/search", query: { q: "{q}" } }
      },
      {
        name: "ipatent_status",
        description: "Corpus and pipeline status.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/status" }
      }
    ]
  },
  mind: {
    title: "mind.q08.org",
    description: "The inside reading surface: its corpus entries and shelves.",
    tools: [
      {
        name: "list_entries",
        description: "Every entry in the mind corpus with its shelf.",
        inputSchema: { type: "object", properties: {} },
        request: { method: "GET", path: "/api/entries.json" }
      }
    ]
  }
};

// WM_HOST_PACKS: which packs a host advertises. A host absent here gets the site pack only, so a new surface is
// agent-readable the moment it is deployed and never advertises a tool it cannot answer.
var WM_HOST_PACKS = {
  "qnfo.org": ["site", "papers"],
  "www.qnfo.org": ["site", "papers"],
  "papers.qnfo.org": ["site", "papers"],
  "archive.qnfo.org": ["site"],
  "legal.qnfo.org": ["site"],
  "qnfo.org:email": ["site"],
  "fleet.qnfo.org": ["site", "fleet"],
  "ideas.qnfo.org": ["site", "ideas"],
  "q08.org": ["site", "signals"],
  "www.q08.org": ["site", "signals"],
  "ask.qwav.tech": ["site", "ask"],
  "ask.qwav.org": ["site", "ask"],
  "ipatent.qnfo.org": ["site", "ipatent"],
  "ipatent.me": ["site", "ipatent"],
  "www.ipatent.me": ["site", "ipatent"],
  "mind.q08.org": ["site", "mind"]
};

// wmHost accepts a URL or a bare hostname (the manifest and the tests both call it with either) and never throws: an
// unknown shape yields "", which lands on the site pack rather than on a tool nobody verified.
function wmHost(url) {
  try {
    var s = typeof url === "string" ? url : String(url && url.hostname || url || "");
    if (s.indexOf("://") >= 0) {
      try { s = new URL(s).hostname; } catch (e2) { return ""; }
    }
    s = s.split("/")[0].split("?")[0].split("#")[0];
    return s.toLowerCase().replace(/:\d+$/, "");
  } catch (e) {
    return "";
  }
}
function wmPackIds(host) {
  var h = wmHost(host);
  return (WM_HOST_PACKS[h] || ["site"]).filter(function (id) { return !!WM_PACK_DEFS[id]; });
}
function wmPacks(host) {
  var out = [];
  var ids = wmPackIds(host);
  for (var i = 0; i < ids.length; i++) {
    var d = WM_PACK_DEFS[ids[i]];
    var tools = [];
    for (var j = 0; j < d.tools.length; j++) {
      var t = d.tools[j];
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, local: t.local || null, request: t.request || null });
    }
    out.push({ id: ids[i], title: d.title, description: d.description, tools: tools });
  }
  return out;
}
function wmManifest(host, worker) {
  var packs = wmPacks(host);
  var n = 0;
  for (var i = 0; i < packs.length; i++) n += packs[i].tools.length;
  return {
    schema_version: "webmcp/v1",
    implementation: "qnfo-webmcp",
    version: WM_VERSION,
    worker: worker || "",
    host: wmHost(host),
    generated_from: "_shared/webmcp.js",
    bridge: WM_BRIDGE_PATH,
    standard: "https://blog.cloudflare.com/webmcp/",
    surface: { document_modelContext: true, navigator_modelContext_fallback: true, degrades_silently: true },
    pack_ids: wmPackIds(host),
    tool_count: n,
    packs: packs
  };
}

// The browser-side module. Written as lines, not a template literal, so nothing in it can be re-interpreted by the
// worker's own bundler and so a diff of this array is a diff of the shipped script.
function wmBridgeSource() {
  var L = [
    "/* QNFO WebMCP bridge " + WM_VERSION + " - generated from _shared/webmcp.js; do not edit. */",
    "(() => {",
    "  if (window.__webmcp && window.__webmcp.bridge) return;",
    "  const state = window.__webmcp = { bridge: true, version: '" + WM_VERSION + "', supported: false, mode: 'init', packs: [], tools: [], registered: 0, errors: [] };",
    "  const ctx = () => {",
    "    try {",
    "      if (document.modelContext && typeof document.modelContext.registerTool === 'function') return document.modelContext;",
    "      if (navigator.modelContext && typeof navigator.modelContext.registerTool === 'function') return navigator.modelContext;",
    "    } catch (e) { state.errors.push('context:' + e); }",
    "    return null;",
    "  };",
    "  const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\\n[... ' + (s.length - n) + ' more characters]' : s; };",
    "  const html2text = (s) => String(s || '')",
    "    .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ').replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')",
    "    .replace(/<\\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '\\n').replace(/<[^>]+>/g, ' ')",
    "    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"').replace(/&#39;/g, \"'\")",
    "    .replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();",
    "  const fill = (tpl, args) => String(tpl || '').replace(/\\{([a-z0-9_]+)\\}/gi, (m, k) => {",
    "    const v = args && args[k];",
    "    return v == null ? '' : String(v);",
    "  });",
    "  const text = (body, isErr) => ({ content: [{ type: 'text', text: body }], isError: !!isErr });",
    "  const pageContext = () => {",
    "    const heads = [];",
    "    document.querySelectorAll('h1,h2,h3').forEach((h) => { if (heads.length < 40) heads.push(h.tagName.toLowerCase() + ': ' + (h.textContent || '').trim().slice(0, 160)); });",
    "    const desc = document.querySelector('meta[name=\"description\"]');",
    "    const sel = String(window.getSelection ? window.getSelection() : '').slice(0, 4000);",
    "    const out = { url: location.href, path: location.pathname, title: document.title, description: desc ? desc.getAttribute('content') : '', lang: document.documentElement.getAttribute('lang') || '', headings: heads, selected_text: sel,",
    "      tools_available: state.tools, packs: state.packs, webmcp_supported: state.supported };",
    "    return text(JSON.stringify(out, null, 1));",
    "  };",
    "  async function call(tool, args) {",
    "    const r = tool.request || {};",
    "    let path = fill(r.path, args);",
    "    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return text('refused: the path must be relative to this site, not an absolute URL', true);",
    "    path = '/' + String(path).replace(/^\\/+/, '');",
    "    const qs = new URLSearchParams();",
    "    if (r.query) for (const k of Object.keys(r.query)) { const v = args && args[k] != null ? args[k] : null; if (v !== null) qs.set(k, String(v)); }",
    "    const url = path + (qs.toString() ? '?' + qs.toString() : '');",
    "    const init = { method: r.method || 'GET', credentials: 'same-origin', headers: { 'accept': r.accept || 'application/json, text/html;q=0.9, text/plain;q=0.8' } };",
    "    if (init.method === 'POST') { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(args || {}); }",
    "    const res = await fetch(url, init);",
    "    const raw = await res.text();",
    "    if (!res.ok) return text('HTTP ' + res.status + ' for ' + url + '\\n' + trunc(raw, 2000), true);",
    "    const ct = (res.headers.get('content-type') || '').toLowerCase();",
    "    const cap = Number(args && args.max_chars) > 0 ? Number(args.max_chars) : 20000;",
    "    if (r.extract === 'loc') {",
    "      const locs = Array.from(raw.matchAll(/<loc>([^<]+)<\\/loc>/gi)).map((m) => m[1]);",
    "      const limit = Number(args && args.limit) > 0 ? Number(args.limit) : 100;",
    "      return text(JSON.stringify({ count: locs.length, urls: locs.slice(0, limit) }, null, 1));",
    "    }",
    "    if (ct.indexOf('json') >= 0) return text(trunc(raw, 40000));",
    "    if (ct.indexOf('html') >= 0) return text(trunc(html2text(raw), cap));",
    "    return text(trunc(raw, cap));",
    "  }",
    "  function toolHandler(tool) {",
    "    return async (args) => {",
    "      try {",
    "        if (tool.local === 'page_context') return pageContext();",
    "        return await call(tool, args || {});",
    "      } catch (e) { state.errors.push(tool.name + ':' + e); return text(tool.name + ' failed: ' + (e && e.message || e), true); }",
    "    };",
    "  }",
    "  async function install(target) {",
    "    const man = state.manifest;",
    "    let n = 0;",
    "    for (const pack of (man.packs || [])) {",
    "      for (const tool of (pack.tools || [])) {",
    "        try {",
    "          await target.registerTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, execute: toolHandler(tool) });",
    "          n++;",
    "        } catch (e) { state.errors.push('register:' + tool.name + ':' + e); }",
    "      }",
    "    }",
    "    state.registered = n;",
    "    state.mode = n ? 'registered' : 'failed';",
    "    return n;",
    "  }",
    "  state.install = install;",
    "  (async () => {",
    "    try {",
    "      const platform = document.querySelector('script[src*=\"/.webmcp/bridge.js\"]:not([data-webmcp])');",
    "      state.platform_bridge = !!platform;",
    "      const res = await fetch('/api/webmcp/manifest.json', { credentials: 'same-origin', headers: { accept: 'application/json' } });",
    "      if (!res.ok) { state.mode = 'no-manifest'; state.errors.push('manifest http ' + res.status); return; }",
    "      state.manifest = await res.json();",
    "      state.packs = (state.manifest.packs || []).map((p) => p.id);",
    "      state.tools = (state.manifest.packs || []).flatMap((p) => (p.tools || []).map((t) => t.name));",
    "      const c = ctx();",
    "      state.supported = !!c;",
    "      if (!c) { state.mode = 'standalone'; return; }",
    "      // Cloudflare's own bridge is on this page (its zone toggle is on): it registers the same tools through /mcp.",
    "      // Registering them a second time would collide on tool names, so ours stands down and says so.",
    "      if (state.platform_bridge) { state.mode = 'platform'; return; }",
    "      await install(c);",
    "    } catch (e) { state.mode = 'error'; state.errors.push(String(e)); }",
    "  })();",
    "})();"
  ];
  return L.join(String.fromCharCode(10)) + String.fromCharCode(10);
}

// wmToolUrl builds the same-origin request a tool describes. Both executors use it: the browser bridge (which calls
// over HTTP with the visitor's session) and the MCP endpoint below (which calls the worker's own router). One builder
// means a tool cannot mean one thing in a browser and another in the MCP surface.
function wmToolUrl(tool, args) {
  var r = tool.request || {};
  var fill = function (tpl) {
    return String(tpl == null ? "" : tpl).replace(/\{([a-z0-9_]+)\}/gi, function (m, k) {
      var v = args && args[k];
      return v == null ? "" : String(v);
    });
  };
  var path = fill(r.path);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  path = "/" + path.replace(/^\/+/, "");
  var qs = [];
  if (r.query) {
    for (var k in r.query) {
      if (!Object.prototype.hasOwnProperty.call(r.query, k)) continue;
      var v = args && args[k] != null ? args[k] : null;
      if (v !== null) qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(fill(r.query[k])));
    }
  }
  return path + (qs.length ? "?" + qs.join("&") : "");
}
function wmStripHtml(s) {
  return String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function wmTrunc(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) + "\n[... " + (s.length - n) + " more characters]" : s;
}
function wmToolResult(text, isError) {
  return { content: [{ type: "text", text: text }], isError: isError ? true : undefined };
}

// wmExecTool runs one tool through the worker's own router. No subrequest: the captured original fetch is called as a
// function, so the tool sees exactly the response a visitor would get, at the cost of no extra invocation.
async function wmExecTool(tool, args, request, origFetch, env, ctx) {
  if (!tool || !tool.request) {
    return wmToolResult("page_context is answered in the browser by the bridge; a server-side caller has no page.", true);
  }
  var target = wmToolUrl(tool, args);
  if (!target) return wmToolResult("refused: a tool path must be relative to this site, not an absolute URL", true);
  var origin = new URL(request.url).origin;
  var init = { method: String(tool.request.method || "GET").toUpperCase(), headers: {} };
  if (init.method === "POST") {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(args || {});
  } else {
    init.headers["accept"] = tool.request.accept || "application/json";
  }
  var res = await origFetch(new Request(origin + target, init), env, ctx);
  var raw = await res.text();
  if (!res.ok) return wmToolResult("HTTP " + res.status + " for " + target + "\n" + wmTrunc(raw, 2000), true);
  var ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (ct.indexOf("html") >= 0) return wmToolResult(wmTrunc(wmStripHtml(raw), 20000));
  return wmToolResult(wmTrunc(raw, WM_MAX_TEXT));
}
function wmFindTool(host, name) {
  var packs = wmPacks(host);
  for (var i = 0; i < packs.length; i++) {
    for (var j = 0; j < packs[i].tools.length; j++) if (packs[i].tools[j].name === name) return packs[i].tools[j];
  }
  return null;
}
function wmMcpCard(host, workerName) {
  var man = wmManifest(host, workerName);
  return {
    schema_version: "mcp/server-card/v1",
    serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + (man.host || "site") },
    description: "The same-origin MCP server behind this site's WebMCP tools. Discovered by Cloudflare's WebMCP bridge (pack mcp-server-client) and by any MCP client that speaks JSON-RPC over HTTP.",
    transport: { type: "http", path: WM_MCP_PATH, methods: ["POST", "GET", "DELETE"], protocolVersions: WM_MCP_PROTOCOLS },
    capabilities: { tools: { listChanged: false } },
    tool_count: man.tool_count,
    packs: man.pack_ids,
    standard: "https://blog.cloudflare.com/webmcp/"
  };
}
async function wmRpc(msg, request, env, ctx, origFetch, workerName) {
  var u = new URL(request.url);
  var host = u.hostname;
  var id = msg && Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : null;
  var method = msg && msg.method ? String(msg.method) : "";
  var params = (msg && msg.params) || {};
  var isNotification = !msg || !Object.prototype.hasOwnProperty.call(msg, "id") || msg.id === null;
  var reply = function (result) { return { jsonrpc: "2.0", id: id, result: result }; };
  var fail = function (code, message) { return { jsonrpc: "2.0", id: id, error: { code: code, message: message } }; };
  if (!msg || msg.jsonrpc !== "2.0" || !method) return isNotification ? null : fail(-32600, "invalid request");
  if (method === "initialize") {
    var asked = String(params.protocolVersion || "");
    var ver = WM_MCP_PROTOCOLS.indexOf(asked) >= 0 ? asked : WM_MCP_PROTOCOLS[1];
    return reply({
      protocolVersion: ver,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "qnfo-webmcp", version: WM_VERSION, title: "QNFO " + host },
      instructions: "Tools published by " + host + ". Every tool reads the same public data the page shows; nothing here takes a credential, and nothing reaches another origin."
    });
  }
  if (method.indexOf("notifications/") === 0) return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") {
    var man = wmManifest(host, workerName);
    var tools = [];
    for (var i = 0; i < man.packs.length; i++) {
      for (var j = 0; j < man.packs[i].tools.length; j++) {
        var t = man.packs[i].tools[j];
        tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
      }
    }
    return reply({ tools: tools });
  }
  if (method === "tools/call") {
    var name = String(params.name || "");
    var tool = wmFindTool(host, name);
    if (!tool) return fail(-32602, "unknown tool: " + name);
    try {
      var result = await wmExecTool(tool, params.arguments || {}, request, origFetch, env, ctx);
      return reply(result);
    } catch (e) {
      return reply(wmToolResult(name + " failed: " + String((e && e.message) || e), true));
    }
  }
  return isNotification ? null : fail(-32601, "method not found: " + method);
}

// wmMcp answers the site's MCP endpoint. Cloudflare's WebMCP bridge (pack mcp-server-client, data-mcp-url defaulting to
// /mcp) runs initialize -> notifications/initialized -> tools/list -> tools/call against it with the visitor's session,
// so the fleet's tools reach document.modelContext through the platform's own implementation wherever the zone toggle
// is on, and through /.webmcp/bridge.js where it is not.
async function wmMcp(request, env, ctx, origFetch, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    if ((u.pathname.replace(/\/+$/, "") || "/") !== WM_MCP_PATH) return null;
    var m = String(request.method || "GET").toUpperCase();
    var h = { "X-WebMCP": WM_VERSION };
    if (m === "GET" || m === "HEAD") {
      var card = JSON.stringify(wmMcpCard(u.hostname, workerName));
      return new Response(m === "HEAD" ? null : card, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION } });
    }
    if (m === "DELETE" || m === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (m !== "POST") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var body = null;
    try {
      body = await request.json();
    } catch (e) {
      return wmJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400, "no-store");
    }
    var batch = Array.isArray(body);
    var msgs = batch ? body : [body];
    var out = [];
    for (var i = 0; i < msgs.length; i++) {
      var r = await wmRpc(msgs[i], request, env, ctx, origFetch, workerName);
      if (r) out.push(r);
    }
    if (!out.length) return new Response(null, { status: 202, headers: h });
    return wmJson(batch ? out : out[0], 200, "no-store");
  } catch (e) {
    return null;
  }
}

function wmJson(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache || "public, max-age=300", "X-WebMCP": WM_VERSION }
  });
}

// wmRoute answers the bridge and the manifest and nothing else. Returns null for every other request, so a caller can
// run it before its own router without changing any existing behaviour.
function wmRoute(request, workerName) {
  try {
    if (!request) return null;
    var u = new URL(request.url);
    var p = u.pathname;
    var isManifest = p === WM_PACKS_PATH || p === WM_MANIFEST_PATH || p === WM_MANIFEST_URL;
    if (p !== WM_BRIDGE_PATH && !isManifest) return null;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET" && m !== "HEAD") return wmJson({ error: "method not allowed" }, 405, "no-store");
    var host = u.hostname;
    if (p === WM_BRIDGE_PATH) {
      var js = wmBridgeSource();
      var h = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-WebMCP": WM_VERSION, "X-Content-Type-Options": "nosniff" };
      return new Response(m === "HEAD" ? null : js, { status: 200, headers: h });
    }
    var man = wmManifest(host, workerName || "");
    man.paths = { bridge: WM_BRIDGE_PATH, packs: WM_MANIFEST_URL, manifest: WM_MANIFEST_URL, mcp: WM_MCP_PATH };
    var hh = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-WebMCP": WM_VERSION };
    return new Response(m === "HEAD" ? null : JSON.stringify(man), { status: 200, headers: hh });
  } catch (e) {
    return null;
  }
}

// The HTMLRewriter handler. It appends the module tag at the end of <head>; a page without a head, a non-200, a
// non-HTML body or a browser we cannot detect all pass through untouched.
// wmPlatformOn: hosts whose zone has Cloudflare own WebMCP preview switched on. Measured 2026-10-25: qnfo.org,
// papers, ideas, fleet and ipatent each carried the platform tag (data-packs="c2pa,mcp-server-client") and
// /.webmcp/bridge.js resolved to the 75,756-byte platform bundle before this worker was reached. The platform
// bundle keeps only the pack names it bundles and does NOT fall back to its defaults, so a second tag carrying
// "site,papers" downloads the same bundle again, registers nothing and logs two warnings. On those hosts this
// worker supplies /mcp and lets the platform bridge register it.
function wmPlatformOn(host) {
  var h = wmHost(host);
  return h === "qnfo.org" || h.slice(-9) === ".qnfo.org";
}
function wmInjector(host, workerName) {
  var ids = wmPackIds(host);
  var packs = ids.join(",");
  var tag = '<script type="module" src="' + WM_BRIDGE_PATH + '" data-webmcp="' + WM_VERSION + '" data-packs="' + packs + '" data-mcp-url="' + WM_MCP_PATH + '" data-worker="' + String(workerName || "").replace(/"/g, "") + '"></script>';
  return {
    element: function (el) {
      try { el.append(tag, { html: true }); } catch (e) { }
    }
  };
}
function wmWithHtml(res, request, workerName) {
  try {
    if (!res || !request) return res;
    var m = String(request.method || "GET").toUpperCase();
    if (m !== "GET") return res;
    if (res.status !== 200) return res;
    var ct = (res.headers.get("Content-Type") || "").toLowerCase();
    if (ct.indexOf("text/html") !== 0) return res;
    if (typeof HTMLRewriter === "undefined") return res;
    var u = new URL(request.url);
    if (wmPlatformOn(u.hostname)) return res;
    if (u.pathname.indexOf("/.webmcp/") === 0 || u.pathname === WM_MCP_PATH) return res;
    var out = new HTMLRewriter().on("head", wmInjector(u.hostname, workerName)).transform(res);
    // A rewritten body no longer matches the origin's Content-Length/ETag; left in place they truncate or mis-cache
    // the page. The X-WebMCP marker is what scripts/webmcp-verify.mjs reads without parsing 200 KB of HTML.
    try {
      out.headers.delete("Content-Length");
      out.headers.delete("ETag");
      out.headers.set("X-WebMCP", WM_VERSION);
    } catch (e2) { }
    return out;
  } catch (e) {
    return res;
  }
}

// wmAttach wraps a worker's default export so every response passes through the steps above. It is a property
// assignment on the exported object, so the runtime sees it on every invocation, and it is idempotent.
function wmAttach(target, workerName) {
  try {
    if (!target || typeof target.fetch !== "function" || target.__wm === WM_VERSION) return target;
    var orig = target.fetch;
    var name = workerName || "";
    target.fetch = async function (request, env, ctx) {
      var routed = wmRoute(request, name);
      if (routed) return routed;
      var mcp = await wmMcp(request, env, ctx, orig, name);
      if (mcp) return mcp;
      var res = await orig.call(this, request, env, ctx);
      return wmWithHtml(res, request, name);
    };
    target.__wm = WM_VERSION;
    return target;
  } catch (e) {
    return target;
  }
}
// ---- WEBMCP-FLEET-1:END ----
// ---- WEBMCP-FLEET-1:ATTACH qnfo-ipatent ----
wmAttach(qnfo_ipatent_default, "qnfo-ipatent");
