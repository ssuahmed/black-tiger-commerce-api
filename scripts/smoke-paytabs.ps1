$ErrorActionPreference = 'Continue'
$base = 'http://localhost:3001/v1'
$results = New-Object System.Collections.Generic.List[object]

function Pass([string]$name, [string]$detail = '') {
  $results.Add([pscustomobject]@{ name = $name; pass = $true; detail = $detail }) | Out-Null
  Write-Output "[PASS] $name — $detail"
}
function Fail([string]$name, [string]$detail = '') {
  $results.Add([pscustomobject]@{ name = $name; pass = $false; detail = $detail }) | Out-Null
  Write-Output "[FAIL] $name — $detail"
}
function ErrDetail($err) {
  if ($err.ErrorDetails -and $err.ErrorDetails.Message) { return $err.ErrorDetails.Message }
  return $err.Exception.Message
}

try {
  $login = Invoke-RestMethod -Method POST -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"identifier":"demo@blacktiger.com.sa","password":"Password1!"}'
  $token = $login.data.accessToken
  $h = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
  Pass 'Auth login' 'token ok'
} catch {
  Fail 'Auth login' (ErrDetail $_)
  exit 1
}

$cart = Invoke-RestMethod -Method POST -Uri "$base/cart" -Headers $h -Body '{}'
$cartId = $cart.data.id
$plist = Invoke-RestMethod -Method GET -Uri "$base/catalog/products?pageSize=1" -Headers $h
$slug = $plist.data.items[0].slug
$detail = Invoke-RestMethod -Method GET -Uri "$base/catalog/products/$([uri]::EscapeDataString($slug))" -Headers $h
$pkg = $detail.data.packagingOptions[0].id
Invoke-RestMethod -Method POST -Uri "$base/cart/$cartId/items" -Headers $h -Body (@{ productSlug = $slug; packagingOptionId = $pkg; quantity = 1; palletType = 'unit' } | ConvertTo-Json) | Out-Null
Invoke-RestMethod -Method PUT -Uri "$base/checkout/$cartId/address" -Headers $h -Body (@{
    shippingAddress       = @{ countryCode = 'SA'; addressLine1 = 'Test St'; city = 'Riyadh'; postalCode = '11564'; usageTypes = @('shipping', 'billing'); label = 'Office' }
    billingSameAsShipping = $true
    deliveryContact       = @{ usageTypes = @('delivery', 'order_notifications'); firstName = 'Pay'; lastName = 'Tabs'; email = 'demo@blacktiger.com.sa'; phone = '+966500000000' }
  } | ConvertTo-Json -Depth 6) | Out-Null
$ship = Invoke-RestMethod -Method GET -Uri "$base/checkout/$cartId/shipping-options" -Headers $h
Invoke-RestMethod -Method PUT -Uri "$base/checkout/$cartId/shipping" -Headers $h -Body (@{ shippingOptionId = $ship.data.options[0].id } | ConvertTo-Json) | Out-Null
Pass 'Checkout prep' "cart=$cartId"

$redirectUrl = $null
$tranRef = $null
try {
  $intent = Invoke-RestMethod -Method POST -Uri "$base/checkout/$cartId/payment-intent" -Headers $h -Body '{"method":"card"}'
  $d = $intent.data
  if ($d.gateway -ne 'paytabs') { Fail 'Card intent gateway' "got $($d.gateway)" } else { Pass 'Card intent gateway' 'paytabs' }
  if (-not $d.redirectUrl) { Fail 'Card intent redirectUrl' 'missing' } else {
    Pass 'Card intent redirectUrl' ([uri]$d.redirectUrl).Host
    $redirectUrl = $d.redirectUrl
    $tranRef = $d.tranRef
  }
  if (-not $d.tranRef) { Fail 'Card intent tranRef' 'missing' } else { Pass 'Card intent tranRef' 'present' }
} catch {
  Fail 'Card intent create' (ErrDetail $_)
}

if ($redirectUrl) {
  try {
    $page = Invoke-WebRequest -Uri $redirectUrl -UseBasicParsing -TimeoutSec 30
    if ($page.StatusCode -eq 200) { Pass 'HPP page open' "HTTP $($page.StatusCode), $($page.RawContentLength) bytes" }
    else { Fail 'HPP page open' "HTTP $($page.StatusCode)" }
  } catch { Fail 'HPP page open' $_.Exception.Message }
}

try {
  Invoke-WebRequest -Uri 'http://localhost:3001/internal/webhooks/paytabs' -Method POST -ContentType 'application/json' -Body '{"tran_ref":"x","payment_result":{"response_status":"A"}}' -UseBasicParsing | Out-Null
  Fail 'Unsigned callback rejected' 'expected 401'
} catch {
  $code = 0
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  if ($code -eq 401) { Pass 'Unsigned callback rejected' '401' } else { Fail 'Unsigned callback rejected' "HTTP $code" }
}

$serverKey = (Select-String -Path 'D:\Devtude\BlackTiger\black-tiger-commerce-api\.env' -Pattern '^PAYTABS_SERVER_KEY=(.+)$').Matches.Groups[1].Value.Trim()
$payloadJson = (@{ tran_ref = $tranRef; payment_result = @{ response_status = 'A'; response_message = 'Authorised' } } | ConvertTo-Json -Compress)
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($serverKey)
$sig = -join ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payloadJson)) | ForEach-Object { $_.ToString('x2') })

try {
  $cb = Invoke-WebRequest -Uri 'http://localhost:3001/internal/webhooks/paytabs' -Method POST -Headers @{ Signature = $sig; 'Content-Type' = 'application/json' } -Body $payloadJson -UseBasicParsing
  $cbBody = $cb.Content | ConvertFrom-Json
  $cbData = if ($cbBody.data) { $cbBody.data } else { $cbBody }
  if ($cb.StatusCode -eq 200 -and $cbData.status -eq 'succeeded') { Pass 'Signed callback succeeded' "status=$($cbData.status)" }
  else { Fail 'Signed callback succeeded' $cb.Content.Substring(0, [Math]::Min(200, $cb.Content.Length)) }
} catch { Fail 'Signed callback succeeded' (ErrDetail $_) }

try {
  $st = Invoke-RestMethod -Method GET -Uri "$base/checkout/$cartId/payment-intent" -Headers $h
  if ($st.data.status -eq 'succeeded') { Pass 'GET payment-intent status' 'succeeded' }
  else { Fail 'GET payment-intent status' $st.data.status }
} catch { Fail 'GET payment-intent status' (ErrDetail $_) }

try {
  $order = Invoke-RestMethod -Method POST -Uri "$base/checkout/$cartId/submit" -Headers $h -Body '{"confirm":true,"paymentMethod":"card"}'
  if ($order.data.orderNumber) { Pass 'Submit after PayTabs' $order.data.orderNumber }
  else { Fail 'Submit after PayTabs' 'no orderNumber' }
} catch { Fail 'Submit after PayTabs' (ErrDetail $_) }

try {
  $cart2 = Invoke-RestMethod -Method POST -Uri "$base/cart" -Headers $h -Body '{}'
  $cid2 = $cart2.data.id
  Invoke-RestMethod -Method POST -Uri "$base/cart/$cid2/items" -Headers $h -Body (@{ productSlug = $slug; packagingOptionId = $pkg; quantity = 1; palletType = 'unit' } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Method PUT -Uri "$base/checkout/$cid2/address" -Headers $h -Body (@{
      shippingAddress       = @{ countryCode = 'SA'; addressLine1 = 'Test St'; city = 'Riyadh'; postalCode = '11564'; usageTypes = @('shipping', 'billing'); label = 'Office' }
      billingSameAsShipping = $true
      deliveryContact       = @{ usageTypes = @('delivery', 'order_notifications'); firstName = 'Cod'; lastName = 'Test'; email = 'demo@blacktiger.com.sa'; phone = '+966500000000' }
    } | ConvertTo-Json -Depth 6) | Out-Null
  $ship2 = Invoke-RestMethod -Method GET -Uri "$base/checkout/$cid2/shipping-options" -Headers $h
  Invoke-RestMethod -Method PUT -Uri "$base/checkout/$cid2/shipping" -Headers $h -Body (@{ shippingOptionId = $ship2.data.options[0].id } | ConvertTo-Json) | Out-Null
  $codIntent = Invoke-RestMethod -Method POST -Uri "$base/checkout/$cid2/payment-intent" -Headers $h -Body '{"method":"cod"}'
  if ($codIntent.data.gateway -eq 'sandbox' -and $codIntent.data.status -eq 'succeeded' -and -not $codIntent.data.redirectUrl) {
    Pass 'COD still sandbox' 'no redirect'
  } else {
    Fail 'COD still sandbox' "gateway=$($codIntent.data.gateway) status=$($codIntent.data.status)"
  }
  $codOrder = Invoke-RestMethod -Method POST -Uri "$base/checkout/$cid2/submit" -Headers $h -Body '{"confirm":true,"paymentMethod":"cod"}'
  Pass 'COD submit' $codOrder.data.orderNumber
} catch { Fail 'COD path' (ErrDetail $_) }

try {
  $ret = Invoke-WebRequest -Uri 'http://localhost:3000/cart/payment/return' -UseBasicParsing -TimeoutSec 20
  if ($ret.StatusCode -eq 200) { Pass 'Return page loads' 'HTTP 200' } else { Fail 'Return page loads' "HTTP $($ret.StatusCode)" }
} catch { Fail 'Return page loads' $_.Exception.Message }

$passed = @($results | Where-Object { $_.pass }).Count
$failed = @($results | Where-Object { -not $_.pass }).Count
Write-Output ""
Write-Output "--- Summary: $passed passed, $failed failed ---"
if ($failed -gt 0) { exit 1 }
