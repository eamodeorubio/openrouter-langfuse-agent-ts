# Spec Delta

## ADDED Requirements

### Requirement: The eval has a fingerprint
A run SHALL write `eval.txt` beside its results before its first request. The file SHALL hold one line: the fingerprint of the eval, twelve characters of the Crockford base 32 alphabet in upper case.

#### Scenario: Written with the target
- **WHEN** a run starts, whatever its target
- **THEN** `eval.txt` exists beside `target.txt` and `catalog.json`, and holds twelve characters of `0123456789ABCDEFGHJKMNPQRSTVWXYZ` and a newline

### Requirement: What the fingerprint covers
The fingerprint SHALL be a hash of `promptfooconfig.yaml`, the files under `cases/` and `rubrics/`, and the sources under `src/` except those of the report, the calibration and the runner. It SHALL depend on the content of those files and on their paths relative to the package, and on nothing else.

#### Scenario: A change to a case
- **WHEN** a question in `cases/search.yaml` changes by one character
- **THEN** the fingerprint changes

#### Scenario: A change outside the eval
- **WHEN** a test, the README, a file of the report or the CLI changes
- **THEN** the fingerprint is the same

#### Scenario: Same files, same fingerprint
- **WHEN** two checkouts hold the same content in the same paths, on any commit, with files read in any order and with Unix or Windows line ends
- **THEN** their fingerprints are equal

#### Scenario: Not an input
- **WHEN** the catalog snapshot of a run differs from that of another
- **THEN** the fingerprints of the two runs are equal

### Requirement: A command prints the fingerprint
The package SHALL offer a script `fingerprint` that prints the fingerprint of the checkout it runs in, one line on stdout, and exits 0. A package whose files cannot be read SHALL give a message on stderr and a non-zero exit.

#### Scenario: Print
- **WHEN** `pnpm --filter ask-openrouter-evals run fingerprint` runs in a checkout
- **THEN** stdout holds the fingerprint that a run of that checkout writes to `eval.txt`
