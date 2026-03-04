# create-models.ps1
Write-Host "📁 Creating models for Inventory Management System..." -ForegroundColor Cyan

# Base path
$basePath = "src/app/shared/models"

# Create directory if it doesn't exist
if (!(Test-Path $basePath)) {
    New-Item -ItemType Directory -Path $basePath -Force | Out-Null
    Write-Host "✅ Created directory: $basePath" -ForegroundColor Green
}

# Create product.model.ts
$productModel = @"
export interface Product {
  id: number;
  name: string;
  category: string;
  quantity: number;
  price: number;
  supplier: string;
  dateAdded: Date;
}

export interface ProductFormData {
  name: string;
  category: string;
  quantity: number;
  price: number;
  supplier: string;
  dateAdded: Date;
}
"@
Set-Content -Path "$basePath/product.model.ts" -Value $productModel -Encoding UTF8
Write-Host "✅ Created: product.model.ts" -ForegroundColor Green

# Create category.model.ts
$categoryModel = @"
export interface Category {
  id: number;
  name: string;
  description: string;
}

export interface CategoryFormData {
  name: string;
  description: string;
}
"@
Set-Content -Path "$basePath/category.model.ts" -Value $categoryModel -Encoding UTF8
Write-Host "✅ Created: category.model.ts" -ForegroundColor Green

# Create user.model.ts
$userModel = @"
export interface User {
  id: number;
  username: string;
  password?: string;
  token: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}
"@
Set-Content -Path "$basePath/user.model.ts" -Value $userModel -Encoding UTF8
Write-Host "✅ Created: user.model.ts" -ForegroundColor Green

# Show final structure
Write-Host "`n📂 Files created:" -ForegroundColor Yellow
Get-ChildItem $basePath -Recurse | ForEach-Object {
    Write-Host "   📄 $($_.Name)" -ForegroundColor White
}

Write-Host "`n✨ All models created successfully!" -ForegroundColor Green
