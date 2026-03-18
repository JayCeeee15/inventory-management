$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$docsDir = Join-Path $root 'docs'
$outputPath = Join-Path $docsDir 'Hospital_Inventory_System_Documentation.docx'
$tempHtmlPath = Join-Path $docsDir 'Hospital_Inventory_System_Documentation.temp.html'
$today = Get-Date -Format 'MMMM d, yyyy'

New-Item -ItemType Directory -Force -Path $docsDir | Out-Null

$html = @"
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Hospital Inventory Management System</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #222; line-height: 1.5; margin: 36px; }
    .title-page { text-align: center; page-break-after: always; margin-top: 100px; }
    .title-page h1 { font-size: 24pt; margin-bottom: 10px; }
    .title-page .subtitle { font-size: 14pt; margin-bottom: 30px; }
    h1 { font-size: 18pt; color: #7a1d1d; margin-top: 20px; margin-bottom: 8px; }
    h2 { font-size: 13pt; color: #7a1d1d; margin-top: 16px; margin-bottom: 6px; }
    p { margin: 0 0 8px 0; }
    ul, ol { margin-top: 4px; margin-bottom: 10px; }
    li { margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 14px 0; }
    th, td { border: 1px solid #cfcfcf; padding: 8px; vertical-align: top; }
    th { background: #f2f2f2; font-weight: 600; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <div class="title-page">
    <h1>Hospital Inventory Management System</h1>
    <div class="subtitle">Tech Stack: Angular, Express.js, MySQL</div>
    <p><strong>Prepared by:</strong></p>
    <p>&nbsp;</p>
    <p>______________________________</p>
    <p style="margin-top: 24px;"><strong>Date:</strong> $today</p>
  </div>

  <h1>1) System Overview</h1>
  <ul>
    <li>The Hospital Inventory Management System manages medicines, supplies, and equipment stock for hospital operations.</li>
    <li>It covers receiving, walk-in sales, patient issue transactions, transaction history, dashboards, role-based access, and user profile management.</li>
    <li>Admin users manage stock intake, master records, monitoring, and audit visibility.</li>
    <li>Staff users handle operational stock-out flows such as walk-in sales and patient issue posting.</li>
    <li>High-level workflow: Receive stock -&gt; inventory updates -&gt; Staff sells/issues stock -&gt; dashboard and transaction history refresh.</li>
  </ul>

  <h1>2) Key Modules</h1>
  <ul>
    <li><strong>Dashboard:</strong> Cards, stock graph, recent activity, and transaction visibility.</li>
    <li><strong>Item Master:</strong> Product setup and maintenance for medicines, supplies, and equipment.</li>
    <li><strong>Categories:</strong> Grouping and classification of inventory items.</li>
    <li><strong>Receiving / Stock In:</strong> Admin stock-in process that increases stock-on-hand and logs RECEIVE entries.</li>
    <li><strong>Walk-in Sale:</strong> Staff transaction flow that deducts stock for in-person purchases.</li>
    <li><strong>Patient Issue:</strong> Staff transaction flow that issues stock to patients or departments.</li>
    <li><strong>Transaction History:</strong> Searchable audit trail for stock movements and references.</li>
    <li><strong>Profile &amp; Avatar Upload:</strong> User profile editing with photo upload and preview.</li>
    <li><strong>Role-based access:</strong> Separation of Admin permissions and Staff permissions.</li>
  </ul>

  <h1>3) Why Angular is Important for This System</h1>
  <ul>
    <li><strong>Component-based UI:</strong> Angular makes it easier to build reusable cards, tables, forms, modals, and side navigation.</li>
    <li><strong>Routing:</strong> Angular routing supports secure navigation between login, admin dashboard, and employee dashboard.</li>
    <li><strong>Forms:</strong> Reactive Forms help validate walk-in sale, patient issue, add item, receiving, and profile forms.</li>
    <li><strong>Services + HttpClient:</strong> Angular services keep API calls to Express organized and reusable.</li>
    <li><strong>State management:</strong> RxJS, Signals, and optionally NgRx help coordinate dashboard refresh and shared data flow.</li>
    <li><strong>Performance:</strong> Angular provides structured change detection and async rendering patterns suitable for dashboards.</li>
    <li><strong>Maintainability:</strong> Angular's folder structure and conventions help the project stay clean as it grows.</li>
  </ul>

  <h1>4) What I Should Learn in Angular (Learning Roadmap)</h1>
  <ol>
    <li><strong>Angular fundamentals:</strong> Components, templates, bindings, directives, and basic app structure.</li>
    <li><strong>Routing + guards:</strong> Protect admin and staff pages using auth and role permissions.</li>
    <li><strong>Reactive forms:</strong> Build reliable forms for walk-in sale, patient issue, add item, and stock receive.</li>
    <li><strong>HttpClient + interceptors:</strong> Attach JWT tokens, centralize errors, and handle retries.</li>
    <li><strong>Observables/RxJS basics:</strong> Learn subscribe, switchMap, forkJoin, takeUntil, retry, and finalize.</li>
    <li><strong>UI framework best practices:</strong> Use Angular Material or PrimeNG consistently for cards, dialogs, and tables.</li>
    <li><strong>Change detection + loading issues:</strong> Understand why data sometimes appears only after clicking and how proper lifecycle handling fixes it.</li>
    <li><strong>Tables:</strong> Pagination, filtering, empty states, and transaction history usability.</li>
    <li><strong>File upload:</strong> Profile photo upload using multipart/form-data.</li>
    <li><strong>Deployment basics:</strong> Build output, environment configuration, and frontend-backend connection setup.</li>
  </ol>

  <h1>5) Angular vs Other Programming Languages/Frameworks</h1>
  <p>Angular is a <strong>frontend framework</strong> written with <strong>TypeScript</strong>. It is not a general programming language by itself. It is used to build browser user interfaces, while backend technologies such as Express, PHP, Java, or C# handle server logic, authentication, and database processing.</p>
  <table>
    <tr>
      <th>Comparison</th>
      <th>Primary Focus</th>
      <th>Strengths</th>
      <th>Tradeoffs</th>
      <th>What It Means for This Project</th>
    </tr>
    <tr>
      <td>Angular vs plain JavaScript/jQuery</td>
      <td>Structured framework vs manual DOM manipulation</td>
      <td>Reusable components, routing, forms, services, stronger large-project organization</td>
      <td>More concepts to learn at the start</td>
      <td>Angular is better for a hospital system with many forms, dashboards, and user roles</td>
    </tr>
    <tr>
      <td>Angular vs React</td>
      <td>Full framework vs UI library</td>
      <td>Angular includes routing, forms, and dependency injection out of the box</td>
      <td>React can be simpler for smaller apps and gives more setup freedom</td>
      <td>Angular fits well when you want an enterprise-style structure and conventions</td>
    </tr>
    <tr>
      <td>Angular vs Vue</td>
      <td>Frontend framework vs frontend framework</td>
      <td>Angular provides stronger built-in architecture for larger teams</td>
      <td>Vue may feel lighter and easier initially</td>
      <td>Angular is a strong choice when the system is expected to scale and stay organized</td>
    </tr>
    <tr>
      <td>Angular vs Node/Express, PHP, Java, C#</td>
      <td>Frontend vs backend responsibilities</td>
      <td>Angular handles screens, forms, and interaction; backend handles business rules and database work</td>
      <td>Angular cannot replace backend processing or persistent storage</td>
      <td>Angular displays and submits data; Express + MySQL save, validate, and secure it</td>
    </tr>
  </table>

  <h1>6) Common Issues in My System and How Angular Helps Fix Them</h1>
  <ul>
    <li><strong>Loading stuck on "Saving...":</strong> Use <code>finalize()</code> so loading flags always reset even on errors.</li>
    <li><strong>Retry button not working:</strong> Re-trigger the observable/API method and reset loading and error state before retrying.</li>
    <li><strong>Sidenav stretching when collapsing:</strong> Keep icon containers fixed and animate only the label visibility.</li>
    <li><strong>Real-time dashboard updates:</strong> Re-fetch summary data or use a shared service with Subject/Signal after successful post actions.</li>
    <li><strong>Stock mismatch after sale:</strong> Always re-fetch from the API after the backend transaction commits.</li>
  </ul>

  <h1>7) Best Practices Checklist</h1>
  <ul>
    <li>Use clear API response handling and correct HTTP status codes.</li>
    <li>Enforce permissions in both the Angular UI and the Express backend.</li>
    <li>Use database transactions for receive, sale, and patient issue posting.</li>
    <li>Keep audit logs and stock ledger entries for all stock-changing actions.</li>
    <li>Prevent negative stock with defensive validations.</li>
    <li>Use a clean folder structure with core, shared, and features.</li>
  </ul>

  <h1>8) Appendix</h1>
  <h2>Suggested Folder Structure for Angular Project</h2>
  <table>
    <tr>
      <th>Folder</th>
      <th>Purpose</th>
    </tr>
    <tr><td>src/app/core</td><td>Auth service, guards, interceptors, and shared API services.</td></tr>
    <tr><td>src/app/shared</td><td>Reusable models, utility helpers, and shared UI parts.</td></tr>
    <tr><td>src/app/features/home</td><td>Landing page and public pages.</td></tr>
    <tr><td>src/app/features/auth</td><td>Login and signup screens.</td></tr>
    <tr><td>src/app/features/dashboard</td><td>Admin dashboard and admin-only modules.</td></tr>
    <tr><td>src/app/features/employee-dashboard</td><td>Staff dashboard and staff operational workflow.</td></tr>
    <tr><td>src/app/features/products</td><td>Item Master list and item form.</td></tr>
    <tr><td>src/app/features/categories</td><td>Category list and category form.</td></tr>
    <tr><td>src/app/features/transactions</td><td>Walk-in sale, patient issue, stock receive, and transaction history.</td></tr>
  </table>

  <h2>Example REST Endpoints</h2>
  <ul>
    <li>POST /api/auth/login - user login</li>
    <li>GET /api/inventory/dashboard/summary - dashboard totals and metrics</li>
    <li>GET /api/inventory/products - item master list</li>
    <li>POST /api/inventory/stock/receive - admin stock receiving</li>
    <li>POST /api/inventory/sales - staff walk-in sale posting</li>
    <li>POST /api/inventory/patient-issues - staff patient issue posting</li>
    <li>GET /api/inventory/stock/movements - transaction history and stock ledger</li>
    <li>DELETE /api/inventory/transactions/:movementId - admin-only transaction delete</li>
  </ul>
</body>
</html>
"@

Set-Content -Path $tempHtmlPath -Value $html -Encoding UTF8

$word = $null
$document = $null

try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($tempHtmlPath)
  $fileFormatDocx = 16
  $document.SaveAs2([string]$outputPath, [ref]$fileFormatDocx)
  $document.Close()
  $document = $null
  Write-Output $outputPath
}
finally {
  if ($document -ne $null) {
    $document.Close()
  }
  if ($word -ne $null) {
    $word.Quit()
  }
  if (Test-Path $tempHtmlPath) {
    Remove-Item $tempHtmlPath -Force
  }
}
