# Spec Delta

## Purpose

Defines how the threshold of each judge rubric is calibrated against a reference judge, Claude Opus 5.5, on the runs of the judge set and on runs known to be bad. The calibration produces figures and a recommendation. It changes no file of the repository.

## ADDED Requirements

### Requirement: Collecting the transcripts
The `calibrate collect` command SHALL read the `results.json` of a run and write one record for each run that was graded, with the `prompt` the CLI was asked, the `transcript` (the tool calls and the answer), the `states` that Jev was sent for each rubric of the case, and the `jevAssertScores`, one field for each rubric Jev answered. It SHALL rebuild each state with the same builders that grade a run, so that the text equals what Jev saw. A run that ended in a provider error SHALL NOT be collected. The records SHALL go in a JSON array, by default in `~/jev-calibration-transcripts.json`, a file outside the repository, which the command SHALL NOT overwrite when it exists unless it is asked to with `--force`, because the file comes to hold paid answers, and then SHALL keep the old file beside it as `<file>.bak`, or `<file>.bak.2` and so on, never over an earlier copy, readable by its owner only. Every command that writes the file SHALL take a lock, `<file>.lock`, and refuse to run, with the name of the lock, while another holds it. Every write of the file SHALL go to a file beside it that is renamed over it, so that a crash leaves the old file whole, and SHALL leave the file readable by its owner only. A file that holds a record with no id, no states, no scores or no transcript SHALL be refused with the number of the record.

#### Scenario: A graded run
- **WHEN** a run of `lookup/known-model` was graded by four rubrics and Jev answered three
- **THEN** its record holds four states, three scores under `jevAssertScores`, and no score for the fourth rubric

#### Scenario: A provider error
- **WHEN** a run ended in a provider error
- **THEN** it has no record

#### Scenario: A file that exists
- **WHEN** the file is there and `--force` is not given
- **THEN** the command exits non-zero, names the file, and leaves it as it was

### Requirement: Negative controls
The `calibrate controls` command SHALL add, for each collected record, copies that are bad by construction, each with a `control` field that names how: `answer-swapped` (the answer of another case), `figure-invented` (the first price or context size of the answer, a figure written with `$`, with thousands separators or before a currency or a unit of tokens, replaced by a wrong one where it stands) and `tools-swapped` (the tool calls of another case, and only of a case none of whose calls repeats a call of the record, with the same tool and the same arguments, because a control that holds the same evidence is not bad). A control SHALL keep the question, rebuild the states of the rubrics it is expected to fail and no others, carry none of the answers of Opus or scores of Jev about the run it was made from, and name the rubrics it is expected to fail, which Opus and Jev then judge like any record. A control SHALL NOT be written when it cannot be made, for lack of a figure to replace or of another case.

#### Scenario: An invented figure
- **WHEN** the answer of a record states `$0.05`
- **THEN** its control `figure-invented` states another price, is expected to fail `judge-grounding`, and keeps its tool calls

#### Scenario: Tool calls that would still ground the answer
- **WHEN** the only other cases call `get_model` with the same slug as the record
- **THEN** no control `tools-swapped` is made for the record

### Requirement: Scoring the controls with Jev
The `calibrate jev` command SHALL score the states of the controls with the same grader as a run, so that a control holds `jevAssertScores` like a record that was collected, and SHALL send no request for a record that already has its scores.

#### Scenario: A rerun
- **WHEN** the command runs twice
- **THEN** the second run sends no request

### Requirement: The reference judge
The `calibrate opus` command SHALL ask Claude Opus 5.5 each rubric of each record, through `claude -p` with the model `claude-opus-5-5`, effort high, no tools and no session kept, with the exact question of the rubric and the exact state Jev saw. The prompt SHALL go on the input of `claude`, so that a large state fits, and the environment of `claude` SHALL NOT hold the key of OpenRouter. A call SHALL be killed and reported when it takes more than ten minutes. A rubric with no question in the rubric files SHALL be reported as failed without a call, for Jev as for Opus. The answer SHALL be one of `yes`, `no` or `ambiguous`, with one sentence of reason, recorded under `opusScore` (one field for each rubric) and `opusReason`. A record that has its answers SHALL NOT be asked again, and a call that fails SHALL leave its field empty and be reported, so that the command can run again.

#### Scenario: Asked once
- **WHEN** a record has `opusScore` for a rubric and the command runs again
- **THEN** that rubric is not asked again

#### Scenario: A failed call
- **WHEN** `claude` exits non-zero for one rubric of one record
- **THEN** the field stays empty, the command reports it and goes on with the others

### Requirement: The threshold of a rubric
The `calibrate analyze` command SHALL work out, for each rubric, on the records Opus answered yes or no: the agreement of Jev at the threshold of the config; the agreement at each threshold from 0 to 1 in steps of 0.05; the AUC; the threshold with the best balanced agreement, and how it moves when each case is left out in turn; the share of ambiguous answers; and, for the controls, how often Opus and Jev reject them. It SHALL print a table and a recommendation for each rubric, and SHALL change no file of the repository. The best threshold SHALL be the middle of the run of consecutive thresholds, around the first best one, whose balanced agreement lies within one point of the best. The output SHALL say how many of the answers in the fit are controls, and the agreement on each case left out when the threshold is fitted on the others. A rubric with an AUC under 0.7 SHALL be reported as not worth a threshold. The analysis SHALL also recommend a weight for each rubric: `keep 0`, unless the AUC is at least 0.9, the agreement on the cases left out, with the threshold fitted on the others, is at least 0.9, there are at least 20 answers of yes and 20 of no, the best threshold moves by no more than 0.1 when each case is left out, and Jev and Opus each reject at least 90% of the controls the rubric is expected to fail, and then `may count`, with the unmet criteria listed in the other case. A recommendation to count SHALL say that a failed rubric would then need an error class of its own. A rubric whose range of best thresholds lies wholly below 0.5 SHALL be reported as suspect, with no threshold recommended, because Jev puts its yes at 0.5 and more, so a rubric that agrees with Opus only below that is read differently by Jev: its wording or its state needs another look.

#### Scenario: Separable scores
- **WHEN** every record Opus calls yes has a score above every record Opus calls no
- **THEN** the AUC is 1 and the best threshold lies between the two groups

#### Scenario: A weight
- **WHEN** a rubric has an AUC of 0.95, an agreement of 0.93, a threshold that moves by 0.05 and controls rejected 96% of the time by both judges
- **THEN** the weight is recommended as `may count`

#### Scenario: A rubric short of one criterion
- **WHEN** the same rubric has an agreement of 0.85
- **THEN** the weight is `keep 0`, and the agreement is named as the criterion not met

#### Scenario: A threshold below 0.5
- **WHEN** the thresholds that agree best with Opus all lie below 0.5
- **THEN** the rubric is reported as suspect, with its wording and its state to review, and no threshold is recommended

#### Scenario: A plateau that reaches 0.5
- **WHEN** the thresholds that agree within one point of the best run from 0.4 to 0.6
- **THEN** the recommendation is 0.5 and the rubric is not suspect

#### Scenario: A rubric that does not separate
- **WHEN** the scores of the yes and of the no records have the same distribution
- **THEN** the AUC is about 0.5 and the rubric is reported as not worth a threshold

### Requirement: The calibration never runs by itself
No calibration command SHALL run from `pnpm test`, from CI, or from the `eval` script. Every command that reaches a service SHALL run only when started by name, and the package's own tests SHALL use a fake `claude` on the path and a loopback server for Jev.

#### Scenario: Offline tests
- **WHEN** the tests of the commands run
- **THEN** no request leaves the machine and no real `claude` is started
