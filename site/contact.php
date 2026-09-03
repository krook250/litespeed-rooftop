<?php
/* Rooftop Auto — walkthrough request handler.
   Bluehost runs PHP, so this works with no extra setup.
   Change $TO if you want the leads going somewhere else. */

$TO      = 'david@litespeedmarketing.com';
$SUBJECT = 'Rooftop walkthrough request';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { header('Location: index.html'); exit; }

// honeypot: real people never fill a hidden field
if (!empty($_POST['website'])) { header('Location: thanks.html'); exit; }

function clean($k, $max = 500) {
  $v = isset($_POST[$k]) ? trim((string) $_POST[$k]) : '';
  $v = str_replace(["\r", "\n", "%0a", "%0d"], ' ', $v);   // header-injection guard
  return substr($v, 0, $max);
}

$name   = clean('name', 120);
$dealer = clean('dealer', 160);
$email  = filter_var(clean('email', 160), FILTER_VALIDATE_EMAIL);
$phone  = clean('phone', 40);
$units  = clean('units', 60);
$msg    = substr(trim((string) ($_POST['msg'] ?? '')), 0, 4000);

if (!$name || !$dealer || !$email) { header('Location: index.html#contact'); exit; }

$body = "New walkthrough request from rooftopauto.com\n\n"
      . "Name:     $name\n"
      . "Dealer:   $dealer\n"
      . "Email:    $email\n"
      . "Phone:    " . ($phone ?: '-') . "\n"
      . "Units:    " . ($units ?: '-') . "\n"
      . "Using:    " . ($msg ?: '-') . "\n\n"
      . "IP:       " . ($_SERVER['REMOTE_ADDR'] ?? '-') . "\n"
      . "Time:     " . date('Y-m-d H:i:s T') . "\n";

$headers  = "From: Rooftop Auto <no-reply@rooftopauto.com>\r\n";
$headers .= "Reply-To: $name <$email>\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

@mail($TO, $SUBJECT, $body, $headers);

// keep a local copy so nothing is lost if mail() is throttled
@file_put_contents(__DIR__ . '/leads.log', $body . "\n----\n", FILE_APPEND | LOCK_EX);

header('Location: thanks.html?s=1');
exit;
