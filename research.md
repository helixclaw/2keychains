# 2keychains Research: macOS Keychain ↔ 1Password Normalization

## 1. macOS Keychain Services API

### Item Classes (kSecClass)

| Class                       | Use Case                                 | Key Identifying Attributes                                                 |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `kSecClassGenericPassword`  | App passwords, tokens, arbitrary secrets | `kSecAttrService` + `kSecAttrAccount`                                      |
| `kSecClassInternetPassword` | Web logins, server credentials           | `kSecAttrServer` + `kSecAttrAccount` + `kSecAttrPort` + `kSecAttrProtocol` |
| `kSecClassCertificate`      | X.509 certificates                       | `kSecAttrLabel`, `kSecAttrSubject`                                         |
| `kSecClassKey`              | Cryptographic keys (RSA/EC)              | `kSecAttrLabel`, `kSecAttrKeyType`, `kSecAttrKeySize`                      |
| `kSecClassIdentity`         | Private key + certificate pair           | Combines key + cert attributes                                             |

### Attributes by Class

**Generic Password:**

- `kSecAttrAccount` — username/account identifier
- `kSecAttrService` — app/service name (e.g. bundle ID)
- `kSecAttrGeneric` — arbitrary custom data blob
- `kSecAttrLabel` — user-visible label
- `kSecAttrDescription` — human-readable description
- `kSecValueData` — the password/secret payload
- `kSecAttrAccessGroup` — keychain sharing group
- `kSecAttrAccessible` — access policy (e.g. `WhenUnlocked`)
- `kSecAttrCreationDate` / `kSecAttrModificationDate`

**Internet Password** (adds to generic):

- `kSecAttrServer` — hostname/domain
- `kSecAttrPort` — port number
- `kSecAttrProtocol` — protocol enum (HTTP, HTTPS, FTP, etc.)
- `kSecAttrPath` — URL path
- `kSecAttrAuthenticationType` — auth type (HTTP Basic, etc.)
- `kSecAttrSecurityDomain` — security realm

**Certificate:**

- `kSecAttrLabel`, `kSecAttrSubject`, `kSecAttrIssuer`
- `kSecAttrSerialNumber`, `kSecAttrSubjectKeyID`
- `kSecAttrPublicKeyHash`
- `kSecValueData` — DER-encoded certificate

**Key:**

- `kSecAttrLabel`, `kSecAttrKeyType` (RSA/EC/AES)
- `kSecAttrKeySize` (bits), `kSecAttrApplicationTag`
- `kSecAttrCanEncrypt`, `kSecAttrCanSign`, etc.
- `kSecValueData` — key data

### CLI: `security` command

```bash
# Find/read
security find-generic-password -a "user" -s "service" -w    # print password
security find-internet-password -a "user" -s "example.com"
security find-identity -v                                     # list identities
security find-certificate -c "CN=example"

# Add
security add-generic-password -a "user" -s "service" -w "pass"
security add-internet-password -a "user" -s "host" -w "pass"

# Delete
security delete-generic-password -a "user" -s "service"

# Dump/list
security dump-keychain login.keychain-db
```

### API Functions

- `SecItemAdd` — create
- `SecItemCopyMatching` — read/search
- `SecItemUpdate` — update
- `SecItemDelete` — delete

---

## 2. 1Password CLI (`op`)

### Item Categories (22+)

| Category                                                                                                                                            | Built-in Fields                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Login**                                                                                                                                           | `username`, `password`, `notesPlain`, URLs       |
| **Password**                                                                                                                                        | `password`, `notesPlain`                         |
| **Secure Note**                                                                                                                                     | `notesPlain`                                     |
| **Credit Card**                                                                                                                                     | `cardholder`, `number`, `expiry`, `cvv`, `type`  |
| **Identity**                                                                                                                                        | name fields, address, phone, email, DOB          |
| **Bank Account**                                                                                                                                    | routing, account number, type                    |
| **SSH Key**                                                                                                                                         | private key, public key, fingerprint             |
| **API Credential**                                                                                                                                  | credential, hostname, type                       |
| **Database**                                                                                                                                        | server, port, database, username, password, type |
| **Server**                                                                                                                                          | URL, username, password                          |
| **Software License**                                                                                                                                | license key, version, publisher                  |
| **Email Account**                                                                                                                                   | email, server, port, username, password          |
| **Document**                                                                                                                                        | attached file + notes                            |
| Also: Driver License, Passport, Medical Record, Membership, Outdoor License, Reward Program, Social Security Number, Crypto Wallet, Wireless Router |

### Field Types

| Type ID      | Label     | Example           |
| ------------ | --------- | ----------------- |
| `CONCEALED`  | password  | hidden by default |
| `STRING`     | text      | plain text        |
| `EMAIL`      | email     | email address     |
| `URL`        | url       | web address       |
| `DATE`       | date      | YYYY-MM-DD        |
| `MONTH_YEAR` | monthYear | YYYYMM            |
| `PHONE`      | phone     | phone number      |
| `OTP`        | otp       | otpauth:// URI    |

### Data Structure

Items have:

- **id** (UUID), **title**, **category**, **vault** (UUID)
- **fields[]** — each with `id`, `type`, `label`, `value`, `purpose` (USERNAME/PASSWORD/NOTES)
- **sections[]** — groups of custom fields, each with `id` and `label`
- **urls[]** — associated URLs with `primary` flag
- **tags[]**, **createdAt**, **updatedAt**

### CLI CRUD

```bash
# List
op item list --vault "Personal"
op item list --categories Login --format json

# Read
op item get "Item Title" --format json
op item get "Item Title" --fields username,password

# Create (assignment syntax)
op item create --category Login \
  --title "My Site" \
  --url "https://example.com" \
  username="me@example.com" \
  password="secret123"

# Create (JSON template)
op item template get Login > template.json
# edit template.json
op item create --template template.json

# Update
op item edit "Item Title" username="newuser"
op item edit "Item Title" --url "https://new.example.com"

# Delete
op item delete "Item Title"

# Get template structure
op item template get Login
op item template get "Credit Card"
```

---

## 3. Normalized Field Mapping

### Item Type Mapping

| Normalized Type              | macOS Keychain                                            | 1Password                 |
| ---------------------------- | --------------------------------------------------------- | ------------------------- |
| **Credential** (web login)   | `kSecClassInternetPassword`                               | Login                     |
| **Credential** (app/generic) | `kSecClassGenericPassword`                                | Password / API Credential |
| **Secure Note**              | `kSecClassGenericPassword` (no password, data in generic) | Secure Note               |
| **Certificate**              | `kSecClassCertificate`                                    | Document (manual)         |
| **Crypto Key**               | `kSecClassKey`                                            | SSH Key (partial)         |
| **Identity** (key+cert)      | `kSecClassIdentity`                                       | ❌ No equivalent          |
| **Credit Card**              | ❌ Not supported                                          | Credit Card               |
| **Personal Identity**        | ❌ Not supported                                          | Identity                  |
| **Bank Account**             | ❌ Not supported                                          | Bank Account              |

### Field Mapping (Credentials)

| Normalized Field  | macOS Keychain                                                          | 1Password                      |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------ |
| `title` / `label` | `kSecAttrLabel`                                                         | `title`                        |
| `username`        | `kSecAttrAccount`                                                       | field with `purpose: USERNAME` |
| `password`        | `kSecValueData`                                                         | field with `purpose: PASSWORD` |
| `url` / `website` | `kSecAttrServer` + `kSecAttrProtocol` + `kSecAttrPort` + `kSecAttrPath` | `urls[0].href`                 |
| `notes`           | `kSecAttrComment` (7-char limit) or `kSecAttrGeneric`                   | field with `purpose: NOTES`    |
| `created`         | `kSecAttrCreationDate`                                                  | `createdAt`                    |
| `modified`        | `kSecAttrModificationDate`                                              | `updatedAt`                    |
| `description`     | `kSecAttrDescription`                                                   | section/field label            |
| `tags`            | ❌ Not supported                                                        | `tags[]`                       |
| `otp` / `totp`    | ❌ Not supported                                                        | field with type `OTP`          |
| `custom_fields`   | `kSecAttrGeneric` (single blob)                                         | `fields[]` in `sections[]`     |

### URL Reconstruction (Keychain → Normalized)

macOS Keychain stores URL components separately for internet passwords:

```
protocol://server:port/path
kSecAttrProtocol + "://" + kSecAttrServer + ":" + kSecAttrPort + kSecAttrPath
```

Must be assembled/decomposed when syncing with 1Password's single URL string.

---

## 4. Gaps and Challenges

### Keychain Limitations

- **No rich item types** — only 5 classes, all credential/crypto focused. No credit cards, identities, bank accounts, etc.
- **No tags or folders** — items are flat within a keychain file
- **No structured custom fields** — `kSecAttrGeneric` is a single opaque data blob
- **No TOTP/OTP support**
- **Notes are limited** — `kSecAttrComment` exists but is rarely used; no rich notes field
- **Access control** — items have ACLs tied to apps; syncing may break access expectations
- **No UUID** — items identified by composite key (class + service + account), not a stable UUID

### 1Password Limitations

- **No certificate/key storage** (except SSH keys) — can store as Documents but loses structured metadata
- **No identity (key+cert pair)** concept
- **Vault-scoped** — items live in vaults; no direct equivalent to keychain files

### Normalization Challenges

1. **Lossy round-trips** — A 1Password Login with TOTP, tags, sections, and multiple URLs will lose data when stored in Keychain. A Keychain internet password with `kSecAttrAuthenticationType` and `kSecAttrSecurityDomain` has no 1Password equivalent.

2. **URL handling** — Keychain decomposes URLs into components; 1Password stores full URLs. Conversion is straightforward but protocol enums need mapping.

3. **Identity tracking** — Need a synthetic mapping table (UUID ↔ class+service+account) to track items across systems since Keychain lacks stable IDs.

4. **One-way richness** — Many 1Password categories (Credit Card, Identity, Bank Account, etc.) simply cannot exist in Keychain. The sync is inherently asymmetric.

5. **Access control mismatch** — Keychain ACLs are app-specific (e.g., "only Safari can read this"). 1Password uses vault-level access. These don't map.

6. **Secrets retrieval** — `security` CLI may prompt for user authorization to read passwords. Programmatic access via `SecItemCopyMatching` requires entitlements or user approval.

7. **Custom data encoding** — If storing 1Password-rich fields in `kSecAttrGeneric`, need a serialization format (JSON blob?) and a way to detect "enriched" vs. plain keychain items.

### Recommended Approach

For a bidirectional sync tool:

- **Keychain → 1Password**: Lossless for credentials. Map `GenericPassword` → Password, `InternetPassword` → Login. Reconstruct URLs. Store Keychain-specific attrs (auth type, security domain) in a custom section.
- **1Password → Keychain**: Lossy for non-credential types. Only sync Login/Password items. Decompose URLs. Store extra 1Password metadata (tags, sections, OTP, custom fields) in `kSecAttrGeneric` as JSON for round-trip preservation.
- **Conflict resolution**: Use modification timestamps. Keychain's `kSecAttrModificationDate` vs 1Password's `updatedAt`.
- **Mapping table**: Maintain a local SQLite DB mapping 1Password UUIDs ↔ Keychain composite keys (class+service+account).
