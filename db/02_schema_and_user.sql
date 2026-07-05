-- ============================================================================
-- Kempen Cricket Club — run against the KempenCricketClub database
-- (connect as the server admin)
--
--   sqlcmd -S <server>.database.windows.net -d KempenCricketClub -U kccroot \
--          -P '<pwd>' -i db/02_schema_and_user.sql
--
-- 1. Creates DB user "controller" with full admin rights on this database
-- 2. Creates tables: members, contact, subscriber
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Application user with admin privileges
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'controller')
BEGIN
    CREATE USER [controller] FOR LOGIN [controller];
END
GO

ALTER ROLE db_owner ADD MEMBER [controller];
GO
GRANT CONTROL ON DATABASE::[KempenCricketClub] TO [controller];
GO

-- ---------------------------------------------------------------------------
-- 2. members — stores BOTH the "join" (trial) and "register" (regular) forms.
--    member_type distinguishes trial candidates from regular members:
--      'trial'   → came via /join  (three free sessions)
--      'regular' → came via /register (full membership registration)
-- ---------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.members', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.members (
        id                   INT IDENTITY(1,1) NOT NULL
                             CONSTRAINT PK_members PRIMARY KEY,
        member_type          VARCHAR(10)   NOT NULL
                             CONSTRAINT CK_members_member_type
                             CHECK (member_type IN ('regular','trial')),
        source               VARCHAR(10)   NOT NULL
                             CONSTRAINT CK_members_source
                             CHECK (source IN ('join','register')),
        category             NVARCHAR(50)  NULL,     -- adult / junior / supporter / student
        first_name           NVARCHAR(100) NOT NULL,
        last_name            NVARCHAR(100) NOT NULL,
        email                NVARCHAR(255) NOT NULL,
        phone                NVARCHAR(50)  NULL,
        town                 NVARCHAR(100) NULL,     -- join form
        address              NVARCHAR(255) NULL,     -- register form
        city                 NVARCHAR(100) NULL,
        dob                  DATE          NULL,
        gender               NVARCHAR(30)  NULL,
        nationality          NVARCHAR(100) NULL,
        birthplace           NVARCHAR(100) NULL,
        national_register_no NVARCHAR(20)  NULL,     -- sensitive (GDPR)
        emergency_contact    NVARCHAR(255) NULL,
        medical_notes        NVARCHAR(MAX) NULL,     -- sensitive (GDPR)
        playing_role         NVARCHAR(50)  NULL,
        batting_hand         NVARCHAR(30)  NULL,
        bowling_style        NVARCHAR(50)  NULL,
        experience           NVARCHAR(MAX) NULL,
        previous_club        NVARCHAR(150) NULL,
        prior_federation     NVARCHAR(150) NULL,
        guardian_name        NVARCHAR(150) NULL,
        guardian_rel         NVARCHAR(50)  NULL,
        guardian_phone       NVARCHAR(50)  NULL,
        guardian_email       NVARCHAR(255) NULL,
        student_id           NVARCHAR(50)  NULL,
        heard_via            NVARCHAR(100) NULL,
        notes                NVARCHAR(MAX) NULL,
        consent_gdpr         BIT NOT NULL CONSTRAINT DF_members_gdpr     DEFAULT (0),
        agree_rules          BIT NOT NULL CONSTRAINT DF_members_rules    DEFAULT (0),
        agree_house          BIT NOT NULL CONSTRAINT DF_members_house    DEFAULT (0),
        agree_photo          BIT NOT NULL CONSTRAINT DF_members_photo    DEFAULT (0),
        agree_guardian       BIT NOT NULL CONSTRAINT DF_members_guardian DEFAULT (0),
        lang                 CHAR(2)       NULL,
        created_at           DATETIME2(0)  NOT NULL
                             CONSTRAINT DF_members_created DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_members_email ON dbo.members (email);
    CREATE INDEX IX_members_type  ON dbo.members (member_type);
END
GO

-- ---------------------------------------------------------------------------
-- 3. contact — contact page submissions
-- ---------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.contact', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.contact (
        id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_contact PRIMARY KEY,
        name       NVARCHAR(150) NOT NULL,
        email      NVARCHAR(255) NOT NULL,
        topic      NVARCHAR(100) NULL,
        message    NVARCHAR(MAX) NOT NULL,
        consent    BIT NOT NULL CONSTRAINT DF_contact_consent DEFAULT (0),
        lang       CHAR(2) NULL,
        created_at DATETIME2(0) NOT NULL
                   CONSTRAINT DF_contact_created DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_contact_email ON dbo.contact (email);
END
GO

-- ---------------------------------------------------------------------------
-- 4. subscriber — footer newsletter signups
-- ---------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.subscriber', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.subscriber (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_subscriber PRIMARY KEY,
        email           NVARCHAR(255) NOT NULL CONSTRAINT UQ_subscriber_email UNIQUE,
        lang            CHAR(2) NULL,
        created_at      DATETIME2(0) NOT NULL
                        CONSTRAINT DF_subscriber_created DEFAULT (SYSUTCDATETIME()),
        unsubscribed_at DATETIME2(0) NULL
    );
END
GO
