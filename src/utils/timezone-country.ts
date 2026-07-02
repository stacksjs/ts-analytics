/**
 * Country from the browser's IANA timezone (Fathom-privacy geolocation).
 *
 * The tracker sends `Intl.DateTimeFormat().resolvedOptions().timeZone` (e.g.
 * "Asia/Manila") and we map it to a country server-side. Nothing about the
 * visitor leaves their machine except a coarse timezone string, no IP is used
 * or shipped to a third party, and only the derived country is stored — the
 * raw timezone is discarded. Works in any deployment (no CDN geo headers
 * needed), so it's the default fallback after CloudFront/Cloudflare headers.
 *
 * Mapping data follows the IANA tz database's zone-to-country table
 * (zone1970.tab) plus the common legacy aliases browsers still emit
 * (Asia/Calcutta, Europe/Kiev, US/Eastern, …). Zones with no single country
 * (UTC, Etc/*) intentionally resolve to nothing.
 */
import { COUNTRY_NAMES } from './geolocation'

const TIMEZONE_COUNTRY: Record<string, string> = {
  // Africa
  'Africa/Abidjan': 'CI', 'Africa/Accra': 'GH', 'Africa/Addis_Ababa': 'ET',
  'Africa/Algiers': 'DZ', 'Africa/Asmara': 'ER', 'Africa/Asmera': 'ER',
  'Africa/Bamako': 'ML', 'Africa/Bangui': 'CF', 'Africa/Banjul': 'GM',
  'Africa/Bissau': 'GW', 'Africa/Blantyre': 'MW', 'Africa/Brazzaville': 'CG',
  'Africa/Bujumbura': 'BI', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA',
  'Africa/Ceuta': 'ES', 'Africa/Conakry': 'GN', 'Africa/Dakar': 'SN',
  'Africa/Dar_es_Salaam': 'TZ', 'Africa/Djibouti': 'DJ', 'Africa/Douala': 'CM',
  'Africa/El_Aaiun': 'EH', 'Africa/Freetown': 'SL', 'Africa/Gaborone': 'BW',
  'Africa/Harare': 'ZW', 'Africa/Johannesburg': 'ZA', 'Africa/Juba': 'SS',
  'Africa/Kampala': 'UG', 'Africa/Khartoum': 'SD', 'Africa/Kigali': 'RW',
  'Africa/Kinshasa': 'CD', 'Africa/Lagos': 'NG', 'Africa/Libreville': 'GA',
  'Africa/Lome': 'TG', 'Africa/Luanda': 'AO', 'Africa/Lubumbashi': 'CD',
  'Africa/Lusaka': 'ZM', 'Africa/Malabo': 'GQ', 'Africa/Maputo': 'MZ',
  'Africa/Maseru': 'LS', 'Africa/Mbabane': 'SZ', 'Africa/Mogadishu': 'SO',
  'Africa/Monrovia': 'LR', 'Africa/Nairobi': 'KE', 'Africa/Ndjamena': 'TD',
  'Africa/Niamey': 'NE', 'Africa/Nouakchott': 'MR', 'Africa/Ouagadougou': 'BF',
  'Africa/Porto-Novo': 'BJ', 'Africa/Sao_Tome': 'ST', 'Africa/Timbuktu': 'ML',
  'Africa/Tripoli': 'LY', 'Africa/Tunis': 'TN', 'Africa/Windhoek': 'NA',

  // America — US
  'America/Adak': 'US', 'America/Anchorage': 'US', 'America/Boise': 'US',
  'America/Chicago': 'US', 'America/Denver': 'US', 'America/Detroit': 'US',
  'America/Indiana/Indianapolis': 'US', 'America/Indiana/Knox': 'US',
  'America/Indiana/Marengo': 'US', 'America/Indiana/Petersburg': 'US',
  'America/Indiana/Tell_City': 'US', 'America/Indiana/Vevay': 'US',
  'America/Indiana/Vincennes': 'US', 'America/Indiana/Winamac': 'US',
  'America/Indianapolis': 'US', 'America/Fort_Wayne': 'US', 'America/Knox_IN': 'US',
  'America/Juneau': 'US', 'America/Kentucky/Louisville': 'US',
  'America/Kentucky/Monticello': 'US', 'America/Louisville': 'US',
  'America/Los_Angeles': 'US', 'America/Menominee': 'US', 'America/Metlakatla': 'US',
  'America/New_York': 'US', 'America/Nome': 'US',
  'America/North_Dakota/Beulah': 'US', 'America/North_Dakota/Center': 'US',
  'America/North_Dakota/New_Salem': 'US', 'America/Phoenix': 'US',
  'America/Shiprock': 'US', 'America/Sitka': 'US', 'America/Yakutat': 'US',
  'America/Atka': 'US',
  'US/Alaska': 'US', 'US/Aleutian': 'US', 'US/Arizona': 'US', 'US/Central': 'US',
  'US/East-Indiana': 'US', 'US/Eastern': 'US', 'US/Hawaii': 'US',
  'US/Indiana-Starke': 'US', 'US/Michigan': 'US', 'US/Mountain': 'US', 'US/Pacific': 'US',
  'Pacific/Honolulu': 'US',

  // America — Canada
  'America/Atikokan': 'CA', 'America/Blanc-Sablon': 'CA', 'America/Cambridge_Bay': 'CA',
  'America/Coral_Harbour': 'CA', 'America/Creston': 'CA', 'America/Dawson': 'CA',
  'America/Dawson_Creek': 'CA', 'America/Edmonton': 'CA', 'America/Fort_Nelson': 'CA',
  'America/Glace_Bay': 'CA', 'America/Goose_Bay': 'CA', 'America/Halifax': 'CA',
  'America/Inuvik': 'CA', 'America/Iqaluit': 'CA', 'America/Moncton': 'CA',
  'America/Montreal': 'CA', 'America/Nipigon': 'CA', 'America/Pangnirtung': 'CA',
  'America/Rainy_River': 'CA', 'America/Rankin_Inlet': 'CA', 'America/Regina': 'CA',
  'America/Resolute': 'CA', 'America/St_Johns': 'CA', 'America/Swift_Current': 'CA',
  'America/Thunder_Bay': 'CA', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'America/Whitehorse': 'CA', 'America/Winnipeg': 'CA', 'America/Yellowknife': 'CA',
  'Canada/Atlantic': 'CA', 'Canada/Central': 'CA', 'Canada/Eastern': 'CA',
  'Canada/Mountain': 'CA', 'Canada/Newfoundland': 'CA', 'Canada/Pacific': 'CA',
  'Canada/Saskatchewan': 'CA', 'Canada/Yukon': 'CA',

  // America — Mexico
  'America/Bahia_Banderas': 'MX', 'America/Cancun': 'MX', 'America/Chihuahua': 'MX',
  'America/Ciudad_Juarez': 'MX', 'America/Ensenada': 'MX', 'America/Hermosillo': 'MX',
  'America/Matamoros': 'MX', 'America/Mazatlan': 'MX', 'America/Merida': 'MX',
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Ojinaga': 'MX',
  'America/Santa_Isabel': 'MX', 'America/Tijuana': 'MX',
  'Mexico/BajaNorte': 'MX', 'Mexico/BajaSur': 'MX', 'Mexico/General': 'MX',

  // America — Brazil
  'America/Araguaina': 'BR', 'America/Bahia': 'BR', 'America/Belem': 'BR',
  'America/Boa_Vista': 'BR', 'America/Campo_Grande': 'BR', 'America/Cuiaba': 'BR',
  'America/Eirunepe': 'BR', 'America/Fortaleza': 'BR', 'America/Maceio': 'BR',
  'America/Manaus': 'BR', 'America/Noronha': 'BR', 'America/Porto_Acre': 'BR',
  'America/Porto_Velho': 'BR', 'America/Recife': 'BR', 'America/Rio_Branco': 'BR',
  'America/Santarem': 'BR', 'America/Sao_Paulo': 'BR',
  'Brazil/Acre': 'BR', 'Brazil/DeNoronha': 'BR', 'Brazil/East': 'BR', 'Brazil/West': 'BR',

  // America — Argentina
  'America/Argentina/Buenos_Aires': 'AR', 'America/Argentina/Catamarca': 'AR',
  'America/Argentina/ComodRivadavia': 'AR', 'America/Argentina/Cordoba': 'AR',
  'America/Argentina/Jujuy': 'AR', 'America/Argentina/La_Rioja': 'AR',
  'America/Argentina/Mendoza': 'AR', 'America/Argentina/Rio_Gallegos': 'AR',
  'America/Argentina/Salta': 'AR', 'America/Argentina/San_Juan': 'AR',
  'America/Argentina/San_Luis': 'AR', 'America/Argentina/Tucuman': 'AR',
  'America/Argentina/Ushuaia': 'AR', 'America/Buenos_Aires': 'AR',
  'America/Catamarca': 'AR', 'America/Cordoba': 'AR', 'America/Jujuy': 'AR',
  'America/Mendoza': 'AR', 'America/Rosario': 'AR',

  // America — rest
  'America/Anguilla': 'AI', 'America/Antigua': 'AG', 'America/Aruba': 'AW',
  'America/Asuncion': 'PY', 'America/Barbados': 'BB', 'America/Belize': 'BZ',
  'America/Bogota': 'CO', 'America/Caracas': 'VE', 'America/Cayenne': 'GF',
  'America/Cayman': 'KY', 'America/Costa_Rica': 'CR', 'America/Curacao': 'CW',
  'America/Danmarkshavn': 'GL', 'America/Dominica': 'DM', 'America/El_Salvador': 'SV',
  'America/Godthab': 'GL', 'America/Grand_Turk': 'TC', 'America/Grenada': 'GD',
  'America/Guadeloupe': 'GP', 'America/Guatemala': 'GT', 'America/Guayaquil': 'EC',
  'America/Guyana': 'GY', 'America/Havana': 'CU', 'America/Jamaica': 'JM',
  'America/Kralendijk': 'BQ', 'America/La_Paz': 'BO', 'America/Lima': 'PE',
  'America/Lower_Princes': 'SX', 'America/Managua': 'NI', 'America/Marigot': 'MF',
  'America/Martinique': 'MQ', 'America/Miquelon': 'PM', 'America/Montevideo': 'UY',
  'America/Montserrat': 'MS', 'America/Nassau': 'BS', 'America/Nuuk': 'GL',
  'America/Panama': 'PA', 'America/Paramaribo': 'SR', 'America/Port-au-Prince': 'HT',
  'America/Port_of_Spain': 'TT', 'America/Puerto_Rico': 'PR', 'America/Punta_Arenas': 'CL',
  'America/Santiago': 'CL', 'America/Santo_Domingo': 'DO', 'America/Scoresbysund': 'GL',
  'America/St_Barthelemy': 'BL', 'America/St_Kitts': 'KN', 'America/St_Lucia': 'LC',
  'America/St_Thomas': 'VI', 'America/St_Vincent': 'VC', 'America/Tegucigalpa': 'HN',
  'America/Thule': 'GL', 'America/Tortola': 'VG', 'America/Virgin': 'VI',
  'America/Coyhaique': 'CL',
  'Chile/Continental': 'CL', 'Chile/EasterIsland': 'CL', 'Cuba': 'CU', 'Jamaica': 'JM',

  // Antarctica (research stations — no meaningful country; map to AQ)
  'Antarctica/Casey': 'AQ', 'Antarctica/Davis': 'AQ', 'Antarctica/DumontDUrville': 'AQ',
  'Antarctica/Macquarie': 'AU', 'Antarctica/Mawson': 'AQ', 'Antarctica/McMurdo': 'AQ',
  'Antarctica/Palmer': 'AQ', 'Antarctica/Rothera': 'AQ', 'Antarctica/South_Pole': 'AQ',
  'Antarctica/Syowa': 'AQ', 'Antarctica/Troll': 'AQ', 'Antarctica/Vostok': 'AQ',

  // Asia
  'Asia/Aden': 'YE', 'Asia/Almaty': 'KZ', 'Asia/Amman': 'JO', 'Asia/Anadyr': 'RU',
  'Asia/Aqtau': 'KZ', 'Asia/Aqtobe': 'KZ', 'Asia/Ashgabat': 'TM', 'Asia/Ashkhabad': 'TM',
  'Asia/Atyrau': 'KZ', 'Asia/Baghdad': 'IQ', 'Asia/Bahrain': 'BH', 'Asia/Baku': 'AZ',
  'Asia/Bangkok': 'TH', 'Asia/Barnaul': 'RU', 'Asia/Beirut': 'LB', 'Asia/Bishkek': 'KG',
  'Asia/Brunei': 'BN', 'Asia/Calcutta': 'IN', 'Asia/Chita': 'RU', 'Asia/Choibalsan': 'MN',
  'Asia/Chongqing': 'CN', 'Asia/Chungking': 'CN', 'Asia/Colombo': 'LK', 'Asia/Dacca': 'BD',
  'Asia/Damascus': 'SY', 'Asia/Dhaka': 'BD', 'Asia/Dili': 'TL', 'Asia/Dubai': 'AE',
  'Asia/Dushanbe': 'TJ', 'Asia/Famagusta': 'CY', 'Asia/Gaza': 'PS', 'Asia/Harbin': 'CN',
  'Asia/Hebron': 'PS', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Hong_Kong': 'HK', 'Asia/Hovd': 'MN',
  'Asia/Irkutsk': 'RU', 'Asia/Istanbul': 'TR', 'Asia/Jakarta': 'ID', 'Asia/Jayapura': 'ID',
  'Asia/Jerusalem': 'IL', 'Asia/Kabul': 'AF', 'Asia/Kamchatka': 'RU', 'Asia/Karachi': 'PK',
  'Asia/Kashgar': 'CN', 'Asia/Kathmandu': 'NP', 'Asia/Katmandu': 'NP', 'Asia/Khandyga': 'RU',
  'Asia/Kolkata': 'IN', 'Asia/Krasnoyarsk': 'RU', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Kuching': 'MY', 'Asia/Kuwait': 'KW', 'Asia/Macao': 'MO', 'Asia/Macau': 'MO',
  'Asia/Magadan': 'RU', 'Asia/Makassar': 'ID', 'Asia/Manila': 'PH', 'Asia/Muscat': 'OM',
  'Asia/Nicosia': 'CY', 'Asia/Novokuznetsk': 'RU', 'Asia/Novosibirsk': 'RU',
  'Asia/Omsk': 'RU', 'Asia/Oral': 'KZ', 'Asia/Phnom_Penh': 'KH', 'Asia/Pontianak': 'ID',
  'Asia/Pyongyang': 'KP', 'Asia/Qatar': 'QA', 'Asia/Qostanay': 'KZ', 'Asia/Qyzylorda': 'KZ',
  'Asia/Rangoon': 'MM', 'Asia/Riyadh': 'SA', 'Asia/Saigon': 'VN', 'Asia/Sakhalin': 'RU',
  'Asia/Samarkand': 'UZ', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Singapore': 'SG',
  'Asia/Srednekolymsk': 'RU', 'Asia/Taipei': 'TW', 'Asia/Tashkent': 'UZ',
  'Asia/Tbilisi': 'GE', 'Asia/Tehran': 'IR', 'Asia/Tel_Aviv': 'IL', 'Asia/Thimbu': 'BT',
  'Asia/Thimphu': 'BT', 'Asia/Tokyo': 'JP', 'Asia/Tomsk': 'RU', 'Asia/Ujung_Pandang': 'ID',
  'Asia/Ulaanbaatar': 'MN', 'Asia/Ulan_Bator': 'MN', 'Asia/Urumqi': 'CN',
  'Asia/Ust-Nera': 'RU', 'Asia/Vientiane': 'LA', 'Asia/Vladivostok': 'RU',
  'Asia/Yakutsk': 'RU', 'Asia/Yangon': 'MM', 'Asia/Yekaterinburg': 'RU', 'Asia/Yerevan': 'AM',
  'Hongkong': 'HK', 'Israel': 'IL', 'Iran': 'IR', 'Japan': 'JP', 'Singapore': 'SG',
  'ROC': 'TW', 'ROK': 'KR', 'PRC': 'CN', 'Turkey': 'TR', 'Egypt': 'EG', 'Libya': 'LY',

  // Atlantic
  'Atlantic/Azores': 'PT', 'Atlantic/Bermuda': 'BM', 'Atlantic/Canary': 'ES',
  'Atlantic/Cape_Verde': 'CV', 'Atlantic/Faeroe': 'FO', 'Atlantic/Faroe': 'FO',
  'Atlantic/Jan_Mayen': 'SJ', 'Atlantic/Madeira': 'PT', 'Atlantic/Reykjavik': 'IS',
  'Atlantic/South_Georgia': 'GS', 'Atlantic/St_Helena': 'SH', 'Atlantic/Stanley': 'FK',
  'Iceland': 'IS',

  // Australia
  'Australia/ACT': 'AU', 'Australia/Adelaide': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Broken_Hill': 'AU', 'Australia/Canberra': 'AU', 'Australia/Currie': 'AU',
  'Australia/Darwin': 'AU', 'Australia/Eucla': 'AU', 'Australia/Hobart': 'AU',
  'Australia/LHI': 'AU', 'Australia/Lindeman': 'AU', 'Australia/Lord_Howe': 'AU',
  'Australia/Melbourne': 'AU', 'Australia/NSW': 'AU', 'Australia/North': 'AU',
  'Australia/Perth': 'AU', 'Australia/Queensland': 'AU', 'Australia/South': 'AU',
  'Australia/Sydney': 'AU', 'Australia/Tasmania': 'AU', 'Australia/Victoria': 'AU',
  'Australia/West': 'AU', 'Australia/Yancowinna': 'AU',

  // Europe
  'Europe/Amsterdam': 'NL', 'Europe/Andorra': 'AD', 'Europe/Astrakhan': 'RU',
  'Europe/Athens': 'GR', 'Europe/Belfast': 'GB', 'Europe/Belgrade': 'RS',
  'Europe/Berlin': 'DE', 'Europe/Bratislava': 'SK', 'Europe/Brussels': 'BE',
  'Europe/Bucharest': 'RO', 'Europe/Budapest': 'HU', 'Europe/Busingen': 'DE',
  'Europe/Chisinau': 'MD', 'Europe/Copenhagen': 'DK', 'Europe/Dublin': 'IE',
  'Europe/Gibraltar': 'GI', 'Europe/Guernsey': 'GG', 'Europe/Helsinki': 'FI',
  'Europe/Isle_of_Man': 'IM', 'Europe/Istanbul': 'TR', 'Europe/Jersey': 'JE',
  'Europe/Kaliningrad': 'RU', 'Europe/Kiev': 'UA', 'Europe/Kirov': 'RU',
  'Europe/Kyiv': 'UA', 'Europe/Lisbon': 'PT', 'Europe/Ljubljana': 'SI',
  'Europe/London': 'GB', 'Europe/Luxembourg': 'LU', 'Europe/Madrid': 'ES',
  'Europe/Malta': 'MT', 'Europe/Mariehamn': 'AX', 'Europe/Minsk': 'BY',
  'Europe/Monaco': 'MC', 'Europe/Moscow': 'RU', 'Europe/Nicosia': 'CY',
  'Europe/Oslo': 'NO', 'Europe/Paris': 'FR', 'Europe/Podgorica': 'ME',
  'Europe/Prague': 'CZ', 'Europe/Riga': 'LV', 'Europe/Rome': 'IT',
  'Europe/Samara': 'RU', 'Europe/San_Marino': 'SM', 'Europe/Sarajevo': 'BA',
  'Europe/Saratov': 'RU', 'Europe/Simferopol': 'UA', 'Europe/Skopje': 'MK',
  'Europe/Sofia': 'BG', 'Europe/Stockholm': 'SE', 'Europe/Tallinn': 'EE',
  'Europe/Tirane': 'AL', 'Europe/Tiraspol': 'MD', 'Europe/Ulyanovsk': 'RU',
  'Europe/Uzhgorod': 'UA', 'Europe/Vaduz': 'LI', 'Europe/Vatican': 'VA',
  'Europe/Vienna': 'AT', 'Europe/Vilnius': 'LT', 'Europe/Volgograd': 'RU',
  'Europe/Warsaw': 'PL', 'Europe/Zagreb': 'HR', 'Europe/Zaporozhye': 'UA',
  'Europe/Zurich': 'CH',
  'Arctic/Longyearbyen': 'SJ',
  'Eire': 'IE', 'GB': 'GB', 'GB-Eire': 'GB', 'Poland': 'PL', 'Portugal': 'PT',
  'W-SU': 'RU',

  // Indian Ocean
  'Indian/Antananarivo': 'MG', 'Indian/Chagos': 'IO', 'Indian/Christmas': 'CX',
  'Indian/Cocos': 'CC', 'Indian/Comoro': 'KM', 'Indian/Kerguelen': 'TF',
  'Indian/Mahe': 'SC', 'Indian/Maldives': 'MV', 'Indian/Mauritius': 'MU',
  'Indian/Mayotte': 'YT', 'Indian/Reunion': 'RE',

  // Pacific
  'Pacific/Apia': 'WS', 'Pacific/Auckland': 'NZ', 'Pacific/Bougainville': 'PG',
  'Pacific/Chatham': 'NZ', 'Pacific/Chuuk': 'FM', 'Pacific/Easter': 'CL',
  'Pacific/Efate': 'VU', 'Pacific/Enderbury': 'KI', 'Pacific/Fakaofo': 'TK',
  'Pacific/Fiji': 'FJ', 'Pacific/Funafuti': 'TV', 'Pacific/Galapagos': 'EC',
  'Pacific/Gambier': 'PF', 'Pacific/Guadalcanal': 'SB', 'Pacific/Guam': 'GU',
  'Pacific/Johnston': 'UM', 'Pacific/Kanton': 'KI', 'Pacific/Kiritimati': 'KI',
  'Pacific/Kosrae': 'FM', 'Pacific/Kwajalein': 'MH', 'Pacific/Majuro': 'MH',
  'Pacific/Marquesas': 'PF', 'Pacific/Midway': 'UM', 'Pacific/Nauru': 'NR',
  'Pacific/Niue': 'NU', 'Pacific/Norfolk': 'NF', 'Pacific/Noumea': 'NC',
  'Pacific/Pago_Pago': 'AS', 'Pacific/Palau': 'PW', 'Pacific/Pitcairn': 'PN',
  'Pacific/Pohnpei': 'FM', 'Pacific/Ponape': 'FM', 'Pacific/Port_Moresby': 'PG',
  'Pacific/Rarotonga': 'CK', 'Pacific/Saipan': 'MP', 'Pacific/Samoa': 'AS',
  'Pacific/Tahiti': 'PF', 'Pacific/Tarawa': 'KI', 'Pacific/Tongatapu': 'TO',
  'Pacific/Truk': 'FM', 'Pacific/Wake': 'UM', 'Pacific/Wallis': 'WF',
  'Pacific/Yap': 'FM',
  'Kwajalein': 'MH', 'NZ': 'NZ', 'NZ-CHAT': 'NZ', 'Navajo': 'US',
}

/**
 * Resolve a browser IANA timezone to the stored country value (display name
 * when known, ISO code otherwise — same convention as the header-based path).
 * Unknown / global zones (UTC, Etc/*) resolve to undefined.
 */
export function getCountryFromTimezone(tz?: string): string | undefined {
  if (!tz || typeof tz !== 'string' || tz.length > 64)
    return undefined
  const code = TIMEZONE_COUNTRY[tz.trim()]
  if (!code)
    return undefined
  return COUNTRY_NAMES[code] || code
}
