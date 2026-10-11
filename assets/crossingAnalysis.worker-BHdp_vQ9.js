(function(){"use strict";const $=`["1", "9"]
["2", "16"]
["2", "16", "14"]
["3", "18", "17"]
["3", "19"]
["4", "20"]
["5", "22", "20"]
["6", "24"]
["7", "25"]
["9", "11", "10"]
["10", "29"]
["11", "12", "13"]
["12", "14"]
["13", "14"]
["13", "15", "33"]
["13", "33", "32"]
["15", "16", "17"]
["18", "37"]
["19", "38", "37"]
["20", "21"]
["21", "22", "41"]
["21", "38"]
["22", "23"]
["23", "24"]
["24", "44"]
["24", "45", "46"]
["25", "45"]
["26", "27"]
["26", "45"]
["26", "47", "65", "46"]
["28", "29", "30"]
["30", "31", "51"]
["31", "32"]
["33", "34"]
["33", "54", "53"]
["34", "35", "54"]
["35", "37", "36"]
["36", "56", "73"]
["39", "40"]
["39", "56"]
["40", "41", "42"]
["42", "44"]
["42", "59"]
["43", "44"]
["43", "46", "62"]
["43", "59"]
["43", "60"]
["46", "79", "94", "93", "77", "78", "60", "61", "63"]
["48", "49"]
["49", "50"]
["50", "51"]
["50", "68"]
["51", "52"]
["52", "53", "55"]
["52", "71", "84", "70"]
["55", "71"]
["55", "72"]
["56", "57", "73"]
["57", "58"]
["58", "59"]
["58", "76"]
["61", "62", "63"]
["64", "65", "67"]
["68", "69"]
["69", "70", "82"]
["71", "87"]
["72", "73", "74", "87"]
["74", "75"]
["75", "76"]
["75", "90"]
["76", "77"]
["77", "78"]
["81", "99"]
["82", "101", "99"]
["83", "84", "85"]
["83", "101"]
["85", "86", "105", "104", "121", "119", "102", "103"]
["86", "87", "88"]
["88", "89"]
["89", "91", "109", "108"]
["89", "105"]
["89", "107", "106"]
["90", "92", "91"]
["92", "93", "109"]
["99", "118"]
["100", "101"]
["100", "103", "102"]
["100", "119", "134", "117", "118"]
["104", "123", "122"]
["105", "106", "126", "125", "124", "123"]
["107", "108"]
["107", "127"]
["108", "130", "129", "128"]
["114", "115", "133", "132"]
["115", "116"]
["120", "134", "121", "122", "139"]
["120", "139", "137", "135"]
["122", "124", "125", "140"]
["126", "127", "128"]
["126", "129", "142", "165", "181", "164", "141"]
["132", "149", "147"]
["133", "151", "150", "149"]
["135", "136", "156", "155"]
["140", "141", "162"]
["145", "147", "148", "146"]
["146", "169", "187", "186", "168"]
["148", "150", "172", "170"]
["159", "177", "175"]
["161", "162", "164", "163"]
["161", "178"]
["163", "180", "179", "178"]
["169", "170", "171"]
["173", "175", "189"]
["175", "177", "176"]
["180", "181", "183", "182"]
["187", "188"]
`,E=`{"id": 1, "x": 166, "y": 77, "color": "white"}
{"id": 2, "x": 375.5, "y": 59.5, "color": "white"}
{"id": 3, "x": 488.5, "y": 67.5, "color": "white"}
{"id": 8, "x": 121, "y": 137.5, "color": "white"}
{"id": 9, "x": 195, "y": 96, "color": "white"}
{"id": 11, "x": 243.5, "y": 110, "color": "white"}
{"id": 12, "x": 281, "y": 107.5, "color": "white"}
{"id": 14, "x": 350.5, "y": 109, "color": "white"}
{"id": 10, "x": 212, "y": 149, "color": "white"}
{"id": 29, "x": 203, "y": 195, "color": "white"}
{"id": 28, "x": 145, "y": 221, "color": "white"}
{"id": 13, "x": 314, "y": 173, "color": "white"}
{"id": 16, "x": 399.5, "y": 127, "color": "white"}
{"id": 17, "x": 443, "y": 129, "color": "white"}
{"id": 30, "x": 210, "y": 251, "color": "white"}
{"id": 18, "x": 484.5, "y": 137, "color": "white"}
{"id": 15, "x": 380.5, "y": 177.5, "color": "white"}
{"id": 19, "x": 557.5, "y": 154, "color": "black"}
{"id": 37, "x": 536, "y": 208.5, "color": "black"}
{"id": 32, "x": 303, "y": 224, "color": "white"}
{"id": 33, "x": 354, "y": 236.5, "color": "white"}
{"id": 34, "x": 411, "y": 241, "color": "white"}
{"id": 48, "x": 153.5, "y": 285.5, "color": "white"}
{"id": 31, "x": 261, "y": 260.5, "color": "white"}
{"id": 4, "x": 658, "y": 66.5, "color": "black"}
{"id": 5, "x": 742.5, "y": 66, "color": "white"}
{"id": 23, "x": 793.5, "y": 105, "color": "white"}
{"id": 6, "x": 861, "y": 67.5, "color": "white"}
{"id": 20, "x": 664, "y": 102.5, "color": "black"}
{"id": 22, "x": 728, "y": 120.5, "color": "black"}
{"id": 38, "x": 591.5, "y": 192, "color": "black"}
{"id": 21, "x": 681, "y": 172, "color": "black"}
{"id": 24, "x": 857, "y": 168.5, "color": "white"}
{"id": 41, "x": 687.5, "y": 223.5, "color": "black"}
{"id": 42, "x": 752.5, "y": 215, "color": "white"}
{"id": 44, "x": 834, "y": 218, "color": "white"}
{"id": 40, "x": 640.5, "y": 245.5, "color": "black"}
{"id": 25, "x": 944, "y": 111.5, "color": "white"}
{"id": 7, "x": 1042.5, "y": 94, "color": "white"}
{"id": 45, "x": 941, "y": 194.5, "color": "white"}
{"id": 26, "x": 1061.5, "y": 184.5, "color": "white"}
{"id": 27, "x": 1131, "y": 126.5, "color": "white"}
{"id": 47, "x": 1119.5, "y": 225.5, "color": "white"}
{"id": 35, "x": 465.5, "y": 240, "color": "white"}
{"id": 36, "x": 501.5, "y": 275.5, "color": "white"}
{"id": 54, "x": 381, "y": 301, "color": "white"}
{"id": 49, "x": 180, "y": 318.5, "color": "white"}
{"id": 51, "x": 262, "y": 343, "color": "white"}
{"id": 53, "x": 353, "y": 335, "color": "white"}
{"id": 50, "x": 182, "y": 361, "color": "white"}
{"id": 52, "x": 336.5, "y": 377, "color": "white"}
{"id": 55, "x": 411.5, "y": 371.5, "color": "white"}
{"id": 72, "x": 461.5, "y": 394.5, "color": "white"}
{"id": 68, "x": 166, "y": 424.5, "color": "white"}
{"id": 69, "x": 228.5, "y": 447, "color": "white"}
{"id": 71, "x": 370, "y": 435, "color": "white"}
{"id": 70, "x": 294, "y": 465.5, "color": "black"}
{"id": 84, "x": 351.5, "y": 487, "color": "black"}
{"id": 87, "x": 463, "y": 494, "color": "black"}
{"id": 81, "x": 133.5, "y": 499, "color": "black"}
{"id": 82, "x": 234.5, "y": 515.5, "color": "black"}
{"id": 83, "x": 334, "y": 537.5, "color": "black"}
{"id": 85, "x": 382.5, "y": 545, "color": "black"}
{"id": 99, "x": 185.5, "y": 581.5, "color": "black"}
{"id": 101, "x": 268.5, "y": 575.5, "color": "black"}
{"id": 103, "x": 371, "y": 594, "color": "black"}
{"id": 86, "x": 457.5, "y": 543.5, "color": "black"}
{"id": 100, "x": 262.5, "y": 625, "color": "black"}
{"id": 118, "x": 184, "y": 668, "color": "black"}
{"id": 102, "x": 346, "y": 652, "color": "black"}
{"id": 104, "x": 438, "y": 657.5, "color": "black"}
{"id": 117, "x": 161.5, "y": 732, "color": "white"}
{"id": 119, "x": 258, "y": 717, "color": "white"}
{"id": 121, "x": 363.5, "y": 710, "color": "white"}
{"id": 122, "x": 465.5, "y": 724, "color": "white"}
{"id": 120, "x": 348, "y": 749.5, "color": "white"}
{"id": 139, "x": 464, "y": 779, "color": "white"}
{"id": 137, "x": 386, "y": 804.5, "color": "white"}
{"id": 134, "x": 212.5, "y": 804, "color": "white"}
{"id": 135, "x": 278, "y": 832, "color": "white"}
{"id": 136, "x": 326.5, "y": 849, "color": "white"}
{"id": 138, "x": 425.5, "y": 819, "color": "blue"}
{"id": 160, "x": 470.5, "y": 879.5, "color": "blue"}
{"id": 153, "x": 172, "y": 868, "color": "white"}
{"id": 155, "x": 215.5, "y": 873.5, "color": "white"}
{"id": 156, "x": 256.5, "y": 880, "color": "white"}
{"id": 158, "x": 316.5, "y": 903.5, "color": "blue"}
{"id": 157, "x": 272, "y": 916, "color": "blue"}
{"id": 152, "x": 128, "y": 928, "color": "white"}
{"id": 154, "x": 171, "y": 934.5, "color": "blue"}
{"id": 159, "x": 349, "y": 943, "color": "white"}
{"id": 161, "x": 480.5, "y": 939.5, "color": "white"}
{"id": 177, "x": 433.5, "y": 979, "color": "white"}
{"id": 175, "x": 281.5, "y": 1007, "color": "white"}
{"id": 174, "x": 175.5, "y": 989, "color": "blue"}
{"id": 173, "x": 137, "y": 1040.5, "color": "white"}
{"id": 189, "x": 209.5, "y": 1055.5, "color": "white"}
{"id": 176, "x": 369.5, "y": 1026.5, "color": "white"}
{"id": 179, "x": 571.5, "y": 1022, "color": "black"}
{"id": 182, "x": 694.5, "y": 1030.5, "color": "black"}
{"id": 183, "x": 747, "y": 1002, "color": "white"}
{"id": 180, "x": 644, "y": 989, "color": "black"}
{"id": 181, "x": 694, "y": 971.5, "color": "black"}
{"id": 163, "x": 576.5, "y": 940, "color": "black"}
{"id": 164, "x": 646, "y": 907.5, "color": "black"}
{"id": 184, "x": 801, "y": 967.5, "color": "blue"}
{"id": 165, "x": 754, "y": 914, "color": "white"}
{"id": 162, "x": 575, "y": 859, "color": "black"}
{"id": 166, "x": 803, "y": 866.5, "color": "blue"}
{"id": 142, "x": 766.5, "y": 805, "color": "white"}
{"id": 141, "x": 636.5, "y": 819, "color": "black"}
{"id": 140, "x": 537, "y": 791, "color": "black"}
{"id": 143, "x": 820, "y": 764, "color": "blue"}
{"id": 125, "x": 570, "y": 751, "color": "black"}
{"id": 126, "x": 624.5, "y": 740.5, "color": "black"}
{"id": 127, "x": 631.5, "y": 676, "color": "black"}
{"id": 123, "x": 484.5, "y": 676, "color": "white"}
{"id": 128, "x": 718.5, "y": 677.5, "color": "black"}
{"id": 129, "x": 748.5, "y": 721, "color": "white"}
{"id": 130, "x": 789.5, "y": 680.5, "color": "white"}
{"id": 107, "x": 644, "y": 629.5, "color": "black"}
{"id": 106, "x": 593.5, "y": 617.5, "color": "black"}
{"id": 108, "x": 760.5, "y": 619, "color": "black"}
{"id": 109, "x": 763, "y": 578, "color": "black"}
{"id": 105, "x": 503, "y": 594, "color": "black"}
{"id": 89, "x": 586, "y": 545, "color": "black"}
{"id": 91, "x": 672, "y": 560, "color": "black"}
{"id": 93, "x": 774, "y": 524.5, "color": "black"}
{"id": 92, "x": 678.5, "y": 508, "color": "black"}
{"id": 90, "x": 634, "y": 502, "color": "black"}
{"id": 88, "x": 507.5, "y": 515, "color": "black"}
{"id": 77, "x": 755.5, "y": 453.5, "color": "white"}
{"id": 75, "x": 651.5, "y": 447.5, "color": "black"}
{"id": 74, "x": 598.5, "y": 430.5, "color": "black"}
{"id": 73, "x": 544, "y": 389.5, "color": "black"}
{"id": 76, "x": 734, "y": 407.5, "color": "black"}
{"id": 60, "x": 807.5, "y": 356.5, "color": "white"}
{"id": 58, "x": 672.5, "y": 368.5, "color": "black"}
{"id": 57, "x": 595, "y": 345, "color": "black"}
{"id": 59, "x": 711, "y": 302, "color": "black"}
{"id": 56, "x": 535, "y": 301.5, "color": "black"}
{"id": 39, "x": 592.5, "y": 261.5, "color": "black"}
{"id": 43, "x": 817, "y": 278.5, "color": "white"}
{"id": 46, "x": 946, "y": 263.5, "color": "white"}
{"id": 62, "x": 884, "y": 303, "color": "white"}
{"id": 61, "x": 874, "y": 359.5, "color": "white"}
{"id": 63, "x": 954, "y": 352, "color": "white"}
{"id": 65, "x": 1067.5, "y": 311, "color": "white"}
{"id": 67, "x": 1119, "y": 318, "color": "white"}
{"id": 64, "x": 1041, "y": 357, "color": "white"}
{"id": 66, "x": 1101, "y": 375, "color": "blue"}
{"id": 78, "x": 833, "y": 447.5, "color": "white"}
{"id": 79, "x": 918, "y": 440.5, "color": "white"}
{"id": 80, "x": 982, "y": 443.5, "color": "blue"}
{"id": 97, "x": 1061, "y": 475, "color": "black"}
{"id": 95, "x": 927.5, "y": 500.5, "color": "blue"}
{"id": 94, "x": 861.5, "y": 514, "color": "black"}
{"id": 98, "x": 1137.5, "y": 522, "color": "blue"}
{"id": 96, "x": 1048, "y": 566.5, "color": "blue"}
{"id": 111, "x": 884.5, "y": 569, "color": "blue"}
{"id": 113, "x": 1005, "y": 608.5, "color": "blue"}
{"id": 116, "x": 1140, "y": 620, "color": "black"}
{"id": 115, "x": 1064, "y": 651.5, "color": "black"}
{"id": 133, "x": 1083.5, "y": 698, "color": "white"}
{"id": 132, "x": 1038.5, "y": 708, "color": "white"}
{"id": 114, "x": 1016.5, "y": 662.5, "color": "black"}
{"id": 112, "x": 917, "y": 645, "color": "black"}
{"id": 110, "x": 849, "y": 660.5, "color": "blue"}
{"id": 131, "x": 951, "y": 721, "color": "blue"}
{"id": 151, "x": 1120.5, "y": 781, "color": "white"}
{"id": 149, "x": 1063.5, "y": 761, "color": "white"}
{"id": 147, "x": 1012, "y": 778, "color": "white"}
{"id": 150, "x": 1079.5, "y": 802, "color": "white"}
{"id": 148, "x": 1046, "y": 821.5, "color": "white"}
{"id": 145, "x": 968, "y": 798.5, "color": "white"}
{"id": 144, "x": 926.5, "y": 832, "color": "blue"}
{"id": 146, "x": 999, "y": 843, "color": "white"}
{"id": 172, "x": 1109.5, "y": 864.5, "color": "white"}
{"id": 170, "x": 1048, "y": 901, "color": "white"}
{"id": 168, "x": 962, "y": 888.5, "color": "white"}
{"id": 167, "x": 919, "y": 935.5, "color": "blue"}
{"id": 169, "x": 1009.5, "y": 921.5, "color": "white"}
{"id": 171, "x": 1067, "y": 945.5, "color": "white"}
{"id": 186, "x": 946.5, "y": 987, "color": "white"}
{"id": 187, "x": 987.5, "y": 996, "color": "white"}
{"id": 188, "x": 1029.5, "y": 1029.5, "color": "white"}
{"id": 185, "x": 846, "y": 1033, "color": "white"}
{"id": 124, "x": 529, "y": 717.5, "color": "black"}
{"id": 178, "x": 508.5, "y": 974.5, "color": "white"}
`,U=`["1", "BB"]
["1", "BV"]
["10", "BJ"]
["10", "BK"]
["100", "FK"]
["100", "FM"]
["100", "FN"]
["101", "FF"]
["101", "FJ"]
["101", "FK"]
["102", "FL"]
["102", "FN"]
["103", "FG"]
["103", "FL"]
["104", "FP"]
["104", "FR"]
["105", "FP"]
["105", "HY"]
["105", "HZ"]
["106", "HP"]
["106", "HY"]
["107", "HP"]
["107", "HQ"]
["107", "HX"]
["108", "HT"]
["108", "HV"]
["108", "HX"]
["109", "HW"]
["109", "JC"]
["11", "BB"]
["11", "BJ"]
["110", "HV"]
["111", "KJ"]
["112", "HW"]
["112", "KP"]
["113", "KM"]
["114", "KM"]
["114", "KP"]
["115", "KM"]
["115", "KN"]
["116", "KK"]
["116", "KN"]
["117", "FQ"]
["117", "FT"]
["118", "FM"]
["118", "FQ"]
["119", "FN"]
["119", "FV"]
["12", "BC"]
["12", "BL"]
["120", "FS"]
["120", "FX"]
["121", "FR"]
["121", "FV"]
["122", "FR"]
["122", "HG"]
["122", "HM"]
["123", "FP"]
["123", "HM"]
["124", "HL"]
["124", "HM"]
["125", "HH"]
["125", "HL"]
["126", "HJ"]
["126", "HN"]
["126", "HR"]
["127", "HN"]
["127", "HQ"]
["128", "HR"]
["128", "HT"]
["129", "HR"]
["129", "HS"]
["13", "BL"]
["13", "BN"]
["13", "BQ"]
["13", "DF"]
["130", "HS"]
["130", "HV"]
["131", "KQ"]
["132", "KP"]
["132", "KR"]
["133", "KN"]
["133", "KR"]
["133", "KS"]
["134", "FT"]
["134", "FV"]
["134", "FY"]
["135", "FY"]
["135", "FZ"]
["136", "FZ"]
["136", "GC"]
["137", "FW"]
["137", "FZ"]
["138", "FW"]
["139", "FS"]
["139", "FW"]
["139", "GB"]
["139", "HG"]
["14", "BD"]
["14", "BL"]
["14", "BQ"]
["140", "HF"]
["140", "HH"]
["141", "HB"]
["141", "HJ"]
["142", "HC"]
["142", "HK"]
["143", "HK"]
["144", "KX"]
["145", "KT"]
["145", "KX"]
["146", "KX"]
["146", "KY"]
["147", "KT"]
["147", "KV"]
["148", "KV"]
["148", "KY"]
["149", "KR"]
["149", "KV"]
["15", "BQ"]
["15", "DG"]
["150", "KV"]
["150", "KW"]
["151", "KS"]
["151", "KW"]
["152", "GF"]
["152", "GM"]
["153", "FY"]
["153", "GF"]
["154", "GD"]
["154", "GM"]
["155", "FY"]
["155", "GD"]
["156", "GC"]
["156", "GD"]
["157", "GH"]
["158", "GC"]
["159", "GH"]
["159", "GJ"]
["16", "BF"]
["16", "BH"]
["16", "BQ"]
["160", "GB"]
["160", "GK"]
["161", "GS"]
["161", "GX"]
["161", "HD"]
["162", "HB"]
["162", "HD"]
["163", "GX"]
["163", "GY"]
["164", "GY"]
["164", "HB"]
["165", "GZ"]
["165", "HC"]
["166", "HC"]
["167", "LC"]
["168", "KX"]
["168", "LC"]
["169", "LB"]
["169", "LD"]
["17", "BH"]
["17", "BS"]
["170", "KZ"]
["170", "LB"]
["171", "KZ"]
["171", "LF"]
["172", "KW"]
["172", "KZ"]
["173", "GN"]
["173", "GP"]
["173", "GQ"]
["174", "GG"]
["174", "GN"]
["175", "GG"]
["175", "GH"]
["175", "GL"]
["175", "GP"]
["175", "GR"]
["176", "GR"]
["176", "GS"]
["177", "GJ"]
["177", "GK"]
["177", "GL"]
["177", "GS"]
["178", "GT"]
["178", "GX"]
["179", "GT"]
["179", "GV"]
["18", "BR"]
["18", "BS"]
["180", "GV"]
["180", "GY"]
["181", "GY"]
["181", "GZ"]
["182", "GV"]
["182", "GW"]
["183", "GW"]
["183", "GZ"]
["184", "GZ"]
["185", "GW"]
["185", "LH"]
["186", "LC"]
["186", "LH"]
["187", "LD"]
["187", "LG"]
["188", "LF"]
["188", "LG"]
["189", "GQ"]
["189", "GR"]
["19", "BT"]
["19", "BZ"]
["2", "BD"]
["2", "BF"]
["2", "BG"]
["20", "BX"]
["20", "CB"]
["20", "CC"]
["21", "CB"]
["21", "CC"]
["21", "CH"]
["22", "BY"]
["22", "CC"]
["22", "CJ"]
["23", "BY"]
["23", "CD"]
["23", "CJ"]
["24", "CD"]
["24", "CL"]
["24", "CN"]
["24", "CR"]
["25", "CK"]
["25", "CS"]
["25", "CT"]
["26", "CV"]
["26", "CW"]
["26", "JW"]
["27", "CV"]
["27", "CW"]
["28", "BM"]
["28", "CX"]
["29", "BK"]
["29", "BP"]
["3", "BH"]
["3", "BR"]
["3", "BW"]
["30", "BP"]
["30", "CX"]
["31", "BP"]
["31", "CY"]
["32", "BN"]
["32", "CZ"]
["33", "CZ"]
["33", "DB"]
["33", "DF"]
["33", "DG"]
["34", "DB"]
["34", "DG"]
["34", "DH"]
["35", "DC"]
["35", "DH"]
["36", "CF"]
["36", "DD"]
["37", "BT"]
["37", "CF"]
["37", "CG"]
["37", "DH"]
["38", "BZ"]
["38", "CG"]
["39", "CG"]
["39", "JS"]
["4", "BW"]
["4", "BX"]
["40", "CG"]
["40", "CP"]
["41", "CH"]
["41", "CJ"]
["42", "CM"]
["42", "CP"]
["42", "CQ"]
["43", "CQ"]
["43", "JR"]
["43", "JV"]
["43", "JZ"]
["44", "CN"]
["44", "CQ"]
["44", "JV"]
["45", "CL"]
["45", "CT"]
["45", "JW"]
["46", "CR"]
["46", "JW"]
["46", "JX"]
["46", "KB"]
["47", "CW"]
["47", "JY"]
["48", "CX"]
["48", "DJ"]
["49", "DJ"]
["49", "DK"]
["5", "BX"]
["5", "BY"]
["50", "DK"]
["50", "DN"]
["50", "DR"]
["51", "CY"]
["51", "DK"]
["51", "DL"]
["51", "DP"]
["52", "DL"]
["52", "DS"]
["52", "DT"]
["53", "CZ"]
["53", "DL"]
["53", "DM"]
["54", "DB"]
["54", "DC"]
["54", "DM"]
["55", "DM"]
["55", "DT"]
["55", "DW"]
["56", "CF"]
["56", "JQ"]
["56", "JS"]
["57", "JL"]
["57", "JS"]
["58", "JM"]
["58", "JR"]
["58", "JT"]
["59", "CP"]
["59", "CQ"]
["59", "JR"]
["6", "CD"]
["6", "CK"]
["60", "JN"]
["60", "JZ"]
["61", "JZ"]
["61", "KD"]
["62", "JX"]
["62", "JZ"]
["63", "JX"]
["63", "KD"]
["64", "KC"]
["64", "KF"]
["65", "JY"]
["65", "KB"]
["66", "KC"]
["67", "JY"]
["67", "KC"]
["68", "DR"]
["68", "DV"]
["68", "DY"]
["69", "DR"]
["69", "DS"]
["69", "DY"]
["7", "CS"]
["7", "CV"]
["70", "DS"]
["70", "FB"]
["71", "DT"]
["71", "DW"]
["71", "DZ"]
["72", "DQ"]
["72", "DW"]
["72", "DX"]
["73", "DQ"]
["73", "JL"]
["73", "JQ"]
["74", "JF"]
["74", "JL"]
["75", "JF"]
["75", "JG"]
["75", "JM"]
["76", "JK"]
["76", "JM"]
["76", "JN"]
["77", "JH"]
["77", "JJ"]
["77", "JP"]
["78", "JJ"]
["78", "JP"]
["79", "KG"]
["79", "KH"]
["8", "BM"]
["8", "BV"]
["80", "KG"]
["81", "DY"]
["81", "FH"]
["82", "FD"]
["82", "FF"]
["83", "FB"]
["83", "FG"]
["84", "DZ"]
["84", "FB"]
["85", "FC"]
["85", "FG"]
["86", "FC"]
["86", "HZ"]
["87", "DX"]
["87", "FC"]
["87", "JD"]
["88", "HZ"]
["88", "JD"]
["89", "HX"]
["89", "HY"]
["89", "HZ"]
["89", "JB"]
["9", "BB"]
["9", "BV"]
["90", "JB"]
["90", "JG"]
["91", "JB"]
["91", "JC"]
["92", "JC"]
["92", "JG"]
["93", "HW"]
["93", "JH"]
["94", "KH"]
["94", "KJ"]
["95", "KH"]
["96", "KL"]
["97", "KF"]
["97", "KK"]
["98", "KK"]
["99", "FD"]
["99", "FH"]
["99", "FJ"]
["BB", "BC"]
["BC", "BD"]
["BG", "BH"]
["BJ", "BN"]
["BK", "BM"]
["BK", "BV"]
["BN", "BP"]
["BR", "BT"]
["BS", "DG"]
["BS", "DH"]
["BW", "BZ"]
["BW", "CB"]
["BZ", "CB"]
["CF", "CG"]
["CG", "CH"]
["CJ", "CM"]
["CK", "CL"]
["CM", "CN"]
["CP", "JT"]
["CR", "JV"]
["CT", "CV"]
["CX", "DK"]
["CY", "CZ"]
["CY", "DL"]
["DC", "DD"]
["DD", "DM"]
["DD", "DQ"]
["DJ", "DN"]
["DN", "DV"]
["DP", "DR"]
["DP", "DS"]
["DW", "DX"]
["DY", "FD"]
["DZ", "FC"]
["FB", "FF"]
["FG", "FK"]
["FH", "FQ"]
["FJ", "FM"]
["FX", "FY"]
["GD", "GG"]
["GG", "GH"]
["GJ", "GK"]
["GS", "GT"]
["HD", "HF"]
["HF", "HG"]
["HH", "HJ"]
["HK", "HS"]
["HN", "HP"]
["HQ", "HT"]
["HV", "HW"]
["HW", "KJ"]
["JB", "JF"]
["JD", "JF"]
["JG", "JK"]
["JH", "JK"]
["JL", "JM"]
["JN", "JP"]
["JN", "JR"]
["JS", "JT"]
["KB", "KF"]
["KF", "KG"]
["KK", "KL"]
["KL", "KM"]
["KP", "KQ"]
["KQ", "KT"]
["KY", "LB"]
["LD", "LF"]
["LG", "LH"]
`,O=`{"id": "BB", "x": 227, "y": 79.5, "starting": false}
{"id": "BC", "x": 265, "y": 72, "starting": false}
{"id": "BD", "x": 342, "y": 82, "starting": false}
{"id": "BF", "x": 387, "y": 91, "starting": false}
{"id": "BG", "x": 403.5, "y": 42.5, "starting": false}
{"id": "BH", "x": 431, "y": 100, "starting": false}
{"id": "BJ", "x": 261, "y": 142, "starting": false}
{"id": "BK", "x": 175, "y": 152, "starting": false}
{"id": "BL", "x": 297.5, "y": 147.5, "starting": false}
{"id": "BM", "x": 132, "y": 183, "starting": false}
{"id": "BN", "x": 286, "y": 188, "starting": false}
{"id": "BP", "x": 236, "y": 228, "starting": false}
{"id": "BQ", "x": 367, "y": 147.5, "starting": false}
{"id": "BR", "x": 512.5, "y": 114, "starting": false}
{"id": "BS", "x": 456, "y": 158.5, "starting": false}
{"id": "BT", "x": 523.5, "y": 154, "starting": false}
{"id": "BV", "x": 156, "y": 114.5, "starting": false}
{"id": "BW", "x": 596.5, "y": 85.5, "starting": false}
{"id": "BX", "x": 719.5, "y": 46.5, "starting": false}
{"id": "BY", "x": 762.5, "y": 86.5, "starting": false}
{"id": "BZ", "x": 591.5, "y": 163, "starting": false}
{"id": "CB", "x": 634, "y": 124.5, "starting": false}
{"id": "CC", "x": 704.5, "y": 145.5, "starting": false}
{"id": "CD", "x": 817, "y": 118, "starting": false}
{"id": "CF", "x": 536, "y": 257, "starting": false}
{"id": "CG", "x": 591, "y": 229.5, "starting": false}
{"id": "CH", "x": 658, "y": 192.5, "starting": false}
{"id": "CJ", "x": 748.5, "y": 157.5, "starting": false}
{"id": "CK", "x": 907.5, "y": 88.5, "starting": false}
{"id": "CL", "x": 875, "y": 145, "starting": false}
{"id": "CM", "x": 776.5, "y": 196, "starting": false}
{"id": "CN", "x": 821.5, "y": 196, "starting": false}
{"id": "CP", "x": 688.5, "y": 262, "starting": false}
{"id": "CQ", "x": 780, "y": 258, "starting": false}
{"id": "CR", "x": 887, "y": 209.5, "starting": false}
{"id": "CS", "x": 973.5, "y": 63.5, "starting": false}
{"id": "CT", "x": 976.5, "y": 132, "starting": false}
{"id": "CV", "x": 1050, "y": 139, "starting": false}
{"id": "CW", "x": 1097, "y": 168, "starting": false}
{"id": "CX", "x": 185.5, "y": 272, "starting": false}
{"id": "CY", "x": 288.5, "y": 293.5, "starting": false}
{"id": "CZ", "x": 325.5, "y": 260.5, "starting": false}
{"id": "DB", "x": 372.5, "y": 273, "starting": false}
{"id": "DC", "x": 440, "y": 257.5, "starting": false}
{"id": "DD", "x": 463.5, "y": 294.5, "starting": false}
{"id": "DF", "x": 332.5, "y": 206, "starting": false}
{"id": "DG", "x": 393.5, "y": 206.5, "starting": false}
{"id": "DH", "x": 470.5, "y": 209.5, "starting": false}
{"id": "DJ", "x": 141.5, "y": 320, "starting": false}
{"id": "DK", "x": 218.5, "y": 319, "starting": false}
{"id": "DL", "x": 313, "y": 339.5, "starting": false}
{"id": "DM", "x": 390.5, "y": 329.5, "starting": false}
{"id": "DN", "x": 138.5, "y": 362, "starting": false}
{"id": "DP", "x": 247, "y": 380, "starting": false}
{"id": "DQ", "x": 491, "y": 391.5, "starting": false}
{"id": "DR", "x": 203.5, "y": 402, "starting": false}
{"id": "DS", "x": 269.5, "y": 421, "starting": false}
{"id": "DT", "x": 350.5, "y": 406.5, "starting": false}
{"id": "DV", "x": 129.5, "y": 440.5, "starting": false}
{"id": "DW", "x": 428.5, "y": 410, "starting": false}
{"id": "DX", "x": 448.5, "y": 449.5, "starting": false}
{"id": "DY", "x": 171.5, "y": 475.5, "starting": false}
{"id": "DZ", "x": 384.5, "y": 468.5, "starting": false}
{"id": "FB", "x": 318.5, "y": 509.5, "starting": false}
{"id": "FC", "x": 415, "y": 524, "starting": false}
{"id": "FD", "x": 202.5, "y": 537.5, "starting": false}
{"id": "FF", "x": 251.5, "y": 545.5, "starting": false}
{"id": "FG", "x": 349.5, "y": 564.5, "starting": false}
{"id": "FH", "x": 147.5, "y": 613, "starting": false}
{"id": "FJ", "x": 205.5, "y": 611.5, "starting": false}
{"id": "FK", "x": 285.5, "y": 604.5, "starting": false}
{"id": "FL", "x": 389, "y": 623.5, "starting": false}
{"id": "FM", "x": 223, "y": 644.5, "starting": false}
{"id": "FN", "x": 306, "y": 679.5, "starting": false}
{"id": "FP", "x": 472.5, "y": 633.5, "starting": true}
{"id": "FQ", "x": 144, "y": 693, "starting": false}
{"id": "FR", "x": 403, "y": 683, "starting": false}
{"id": "FS", "x": 406, "y": 720, "starting": false}
{"id": "FT", "x": 185, "y": 767.5, "starting": false}
{"id": "FV", "x": 282.5, "y": 766, "starting": false}
{"id": "FW", "x": 421, "y": 792.5, "starting": false}
{"id": "FX", "x": 287.5, "y": 789.5, "starting": false}
{"id": "FY", "x": 214.5, "y": 838.5, "starting": false}
{"id": "FZ", "x": 352, "y": 822, "starting": false}
{"id": "GB", "x": 478, "y": 846, "starting": false}
{"id": "GC", "x": 306, "y": 871, "starting": false}
{"id": "GD", "x": 217, "y": 911.5, "starting": false}
{"id": "GF", "x": 131, "y": 892.5, "starting": false}
{"id": "GG", "x": 230, "y": 960, "starting": false}
{"id": "GH", "x": 290.5, "y": 950.5, "starting": false}
{"id": "GJ", "x": 409, "y": 939.5, "starting": false}
{"id": "GK", "x": 465.5, "y": 913.5, "starting": false}
{"id": "GL", "x": 363, "y": 998, "starting": false}
{"id": "GM", "x": 118.5, "y": 961, "starting": false}
{"id": "GN", "x": 124, "y": 1016, "starting": false}
{"id": "GP", "x": 210.5, "y": 1028.5, "starting": false}
{"id": "GQ", "x": 132.5, "y": 1069.5, "starting": false}
{"id": "GR", "x": 286.5, "y": 1041, "starting": false}
{"id": "GS", "x": 450, "y": 1009.5, "starting": false}
{"id": "GT", "x": 508.5, "y": 1016, "starting": false}
{"id": "GV", "x": 641.5, "y": 1028, "starting": false}
{"id": "GW", "x": 744.5, "y": 1030.5, "starting": false}
{"id": "GX", "x": 513.5, "y": 933, "starting": false}
{"id": "GY", "x": 644, "y": 948.5, "starting": false}
{"id": "GZ", "x": 748.5, "y": 975, "starting": false}
{"id": "HB", "x": 647.5, "y": 867.5, "starting": false}
{"id": "HC", "x": 758.5, "y": 853.5, "starting": false}
{"id": "HD", "x": 507.5, "y": 853.5, "starting": false}
{"id": "HF", "x": 500.5, "y": 794.5, "starting": false}
{"id": "HG", "x": 494, "y": 762, "starting": false}
{"id": "HH", "x": 576, "y": 788.5, "starting": false}
{"id": "HJ", "x": 625, "y": 776, "starting": false}
{"id": "HK", "x": 772.5, "y": 758, "starting": false}
{"id": "HL", "x": 561, "y": 714.5, "starting": false}
{"id": "HM", "x": 497, "y": 718.5, "starting": false}
{"id": "HN", "x": 601.5, "y": 686.5, "starting": false}
{"id": "HP", "x": 597, "y": 652, "starting": true}
{"id": "HQ", "x": 660.5, "y": 662, "starting": false}
{"id": "HR", "x": 717.5, "y": 715.5, "starting": false}
{"id": "HS", "x": 777.5, "y": 728.5, "starting": false}
{"id": "HT", "x": 721, "y": 641, "starting": false}
{"id": "HV", "x": 802.5, "y": 635.5, "starting": false}
{"id": "HW", "x": 819.5, "y": 595, "starting": false}
{"id": "HX", "x": 681, "y": 590.5, "starting": false}
{"id": "HY", "x": 588, "y": 579.5, "starting": false}
{"id": "HZ", "x": 512, "y": 554, "starting": true}
{"id": "JB", "x": 614.5, "y": 520, "starting": false}
{"id": "JC", "x": 710, "y": 534.5, "starting": true}
{"id": "JD", "x": 501.5, "y": 478, "starting": true}
{"id": "JF", "x": 598.5, "y": 462, "starting": false}
{"id": "JG", "x": 654.5, "y": 481.5, "starting": false}
{"id": "JH", "x": 728, "y": 480, "starting": true}
{"id": "JJ", "x": 782, "y": 496, "starting": false}
{"id": "JK", "x": 692.5, "y": 444, "starting": false}
{"id": "JL", "x": 598.5, "y": 400, "starting": false}
{"id": "JM", "x": 653.5, "y": 401, "starting": false}
{"id": "JN", "x": 768, "y": 385.5, "starting": false}
{"id": "JP", "x": 808.5, "y": 409.5, "starting": false}
{"id": "JQ", "x": 532, "y": 350.5, "starting": false}
{"id": "JR", "x": 731, "y": 338, "starting": false}
{"id": "JS", "x": 592.5, "y": 294, "starting": false}
{"id": "JT", "x": 653, "y": 274.5, "starting": false}
{"id": "JV", "x": 849.5, "y": 241, "starting": false}
{"id": "JW", "x": 973.5, "y": 243, "starting": false}
{"id": "JX", "x": 918, "y": 279.5, "starting": false}
{"id": "JY", "x": 1140.5, "y": 281, "starting": false}
{"id": "JZ", "x": 849, "y": 327, "starting": false}
{"id": "KB", "x": 993, "y": 353.5, "starting": false}
{"id": "KC", "x": 1076.5, "y": 338.5, "starting": false}
{"id": "KD", "x": 905, "y": 393, "starting": false}
{"id": "KF", "x": 1004, "y": 373.5, "starting": false}
{"id": "KG", "x": 953.5, "y": 408.5, "starting": false}
{"id": "KH", "x": 892, "y": 471, "starting": false}
{"id": "KJ", "x": 843, "y": 544.5, "starting": false}
{"id": "KK", "x": 1113.5, "y": 566.5, "starting": false}
{"id": "KL", "x": 1074, "y": 593, "starting": false}
{"id": "KM", "x": 1030.5, "y": 635, "starting": false}
{"id": "KN", "x": 1098.5, "y": 669.5, "starting": false}
{"id": "KP", "x": 1003.5, "y": 691, "starting": false}
{"id": "KQ", "x": 985.5, "y": 731.5, "starting": false}
{"id": "KR", "x": 1073, "y": 727, "starting": false}
{"id": "KS", "x": 1131.5, "y": 750.5, "starting": false}
{"id": "KT", "x": 971.5, "y": 766.5, "starting": false}
{"id": "KV", "x": 1055, "y": 791.5, "starting": false}
{"id": "KW", "x": 1107, "y": 811.5, "starting": false}
{"id": "KX", "x": 963, "y": 835.5, "starting": false}
{"id": "KY", "x": 1038, "y": 851.5, "starting": false}
{"id": "KZ", "x": 1081, "y": 916.5, "starting": false}
{"id": "LB", "x": 1022.5, "y": 887.5, "starting": false}
{"id": "LC", "x": 955.5, "y": 940, "starting": false}
{"id": "LD", "x": 995, "y": 954, "starting": false}
{"id": "LF", "x": 1051, "y": 974.5, "starting": false}
{"id": "LG", "x": 981, "y": 1036, "starting": false}
{"id": "LH", "x": 932.5, "y": 1035.5, "starting": false}
`,q=`[154, 174]
[138, 157, 158, 160]
[110, 131, 143, 144, 166, 167, 184]
[80, 95, 96, 111, 113]
[66, 98]
`,K=(n,i)=>n.split(/\r?\n/).map(t=>t.trim()).filter(Boolean).map((t,o)=>{try{return JSON.parse(t)}catch{throw new Error(`Invalid JSON in ${i} on line ${o+1}`)}}),z=(n,i)=>`${i<600?"N":"S"}${n<600?"W":"E"}`,_=K(E,"circles.jsonl"),A=K(O,"squares.jsonl"),nn=K(U,"connections.jsonl"),R=K($,"alley_groups.jsonl").map(n=>n.map(Number)),W=K(q,"water_groups.jsonl").map(n=>n.map(Number)),G=_.map(n=>({...n,quadrant:z(n.x,n.y)})).sort((n,i)=>n.id-i.id),B=A.slice().sort((n,i)=>n.id.localeCompare(i.id)),J=new Map(G.map(n=>[n.id,n])),L=new Map(B.map(n=>[n.id,n])),tn=B.filter(n=>n.starting),v=new Map(B.map(n=>[n.id,[]])),S=new Map(G.map(n=>[n.id,[]])),N=[];for(const[n,i]of nn){const t=/^\d+$/.test(n),o=/^\d+$/.test(i);if(t!==o){const s=Number(t?n:i),e=t?i:n;if(!J.has(s)||!L.has(e))throw new Error(`Unknown connection endpoint: ${n}, ${i}`);v.get(e)?.push(s),S.get(s)?.push(e)}else if(!t&&!o){if(!L.has(n)||!L.has(i))throw new Error(`Unknown crossing connection: ${n}, ${i}`);N.push([n,i])}else throw new Error(`Numbered circles cannot connect directly: ${n}, ${i}`)}const m=new Map(B.map(n=>[n.id,new Set]));for(const[n,i]of N)m.get(n)?.add(i),m.get(i)?.add(n);const b=new Map(G.map(n=>[n.id,new Map])),on=(n,i,t)=>{const o=b.get(n),s=o?.get(i)??[];s.some(e=>e.length===t.length&&e.every((r,a)=>r===t[a]))||s.push(t),o?.set(i,s)},P=(n,i,t,o)=>{for(const s of v.get(i)??[])s!==n&&on(n,s,t);for(const s of m.get(i)??[])o.has(s)||P(n,s,[...t,s],new Set([...o,s]))};for(const n of G)for(const i of S.get(n.id)??[])P(n.id,i,[i],new Set([i]));const Y=new Map(B.map(n=>[n.id,new Set])),Z=new Map(B.map(n=>[n.id,new Map])),T=(n,i,t=[])=>{if(n!==i){Y.get(n)?.add(i),Y.get(i)?.add(n);for(const[o,s,e]of[[n,i,t],[i,n,[...t].reverse()]]){const r=Z.get(o)?.get(s)??[];r.some(a=>a.length===e.length&&a.every((g,x)=>g===e[x]))||r.push([...e]),Z.get(o)?.set(s,r)}}};for(const[n,i]of N)T(n,i);for(const[n,i]of S)for(let t=0;t<i.length;t+=1)for(let o=t+1;o<i.length;o+=1){const s=i[t],e=i[o];s&&e&&T(s,e,[n])}const V=n=>{const i=new Map(G.map(t=>[t.id,new Set]));for(const t of n)for(const o of t){if(!J.has(o))throw new Error(`Unknown grouped circle: ${o}`);for(const s of t)o!==s&&i.get(o)?.add(s)}return i},sn=V(R),en=V(W);for(const n of R)if(n.some(i=>J.get(i)?.color==="blue"))throw new Error("Alley groups cannot contain blue circles");for(const n of W)if(n.some(i=>J.get(i)?.color!=="blue"))throw new Error("Water groups must contain only blue circles");if(G.length!==189||B.length!==174||tn.length!==6)throw new Error("Whitehall map data has unexpected node counts");const rn=n=>(v.get(n)??[]).slice().sort((i,t)=>i-t),X=n=>J.get(n)?.color!=="blue",an=n=>new Set(Object.values(n)),ln=(n,i)=>{if(i.type==="normal"){const o=an(i.investigatorPositions);return[...b.get(n)?.entries()??[]].filter(([,s])=>s.some(e=>e.every(r=>!o.has(r)))).map(([s])=>[s])}if(i.type==="alley"||i.type==="boat")return[...(i.type==="alley"?sn:en).get(n)??[]].map(s=>[s]);const t=[];for(const o of b.get(n)?.keys()??[])if(X(o))for(const s of b.get(o)?.keys()??[])s===n||s===o||!X(s)||t.push([o,s]);return t},cn=n=>{const i=[...new Set(n.observations.filter(e=>e.kind==="clue"&&e.found).map(e=>e.circleId))],t=new Map(i.map((e,r)=>[e,1n<<BigInt(r)])),o=new Map;for(const e of n.observations)e.kind==="clue"&&!e.found&&o.set(e.circleId,Math.max(o.get(e.circleId)??-1,e.afterMove));const s=new Map;for(const e of n.observations){const r=s.get(e.afterMove)??[];r.push(e),s.set(e.afterMove,r)}return{evidence:n,bitForCircle:t,negativeUntil:o,observationsByMove:s,transitionsByMove:new Map}},dn=new Map([...J.keys()].map(n=>[n,1n<<BigInt(n)])),F=n=>dn.get(n)??1n<<BigInt(n),yn=(n,i,t)=>{let o=n.transitionsByMove.get(i);o||(o=new Map,n.transitionsByMove.set(i,o));const s=o.get(t);if(s)return s;const e=[],r=n.evidence.moves[i-1];if(r)for(const a of ln(t,r)){if(a.some(l=>(n.negativeUntil.get(l)??-1)>=i))continue;const g=a[a.length-1];if(g===void 0)continue;let x=0n,y=0n;for(const l of a)x|=n.bitForCircle.get(l)??0n,y|=F(l);e.push({position:g,positiveMask:x,visitedMask:y})}return o.set(t,e),e},xn=n=>{const i=new Set(Object.values(n??{})),t=new Map;return o=>{if(!n)return o instanceof Set?o:new Set(o);const s=new Set;for(const e of o){let r=t.get(e);r||(r=[...b.get(e)??[]].filter(([,a])=>a.some(g=>g.every(x=>!i.has(x)))).map(([a])=>a),t.set(e,r));for(const a of r)s.add(a)}return s}},Q=(n,i=0n)=>{const{evidence:t,bitForCircle:o,negativeUntil:s,observationsByMove:e}=n;if((s.get(t.start)??-1)>=0||(F(t.start)&i)!==0n)return[];const r=o.size===0?y=>y:(y,l)=>`${y}:${l}`;let a=new Map;const g=o.get(t.start)??0n,x=F(t.start);a.set(r(t.start,g),{position:t.start,positiveMask:g,visitedUnion:x,visitedIntersection:x});for(let y=1;y<=t.moves.length;y+=1){const l=new Map;for(const w of a.values())for(const c of yn(n,y,w.position)){if((c.visitedMask&i)!==0n)continue;const f=w.positiveMask|c.positiveMask,d=c.position,C=w.visitedUnion|c.visitedMask,D=w.visitedIntersection|c.visitedMask,u=r(d,f),M=l.get(u);M?(M.visitedUnion|=C,M.visitedIntersection&=D):l.set(u,{position:d,positiveMask:f,visitedUnion:C,visitedIntersection:D})}const h=e.get(y)??[];if(a=l,h.length>0)for(const[w,c]of l)h.every(f=>{if(f.kind==="arrest")return c.position!==f.circleId;if(!f.found)return!0;const d=o.get(f.circleId)??0n;return(c.positiveMask&d)!==0n})||l.delete(w)}return[...a.values()]},I=new WeakMap,fn=(n,i)=>{if(!n)return new Map;const t=i?`next:${Object.values(i).sort().join(",")}`:"current",o=I.get(n)??new Map,s=o.get(t);if(s)return s;const e=cn(n),r=Q(e),a=xn(i),g=a(r.map(h=>h.position)).size,x=new Map([["",r]]),y=h=>{const w=h.join(","),c=x.get(w);if(c)return c;const f=h.reduce((C,D)=>C|F(D),0n),d=Q(e,f);return x.set(w,d),d},l=new Map;for(const h of B){const w=rn(h.id).filter(d=>r.some(C=>(C.visitedUnion&F(d))!==0n)),c=new Map,f=d=>{const C=d.join(","),D=c.get(C);if(D!==void 0)return D;const u=y(d);let H=a(u.map(p=>p.position)).size;if(H===0)return 0;for(const p of w){if(d.includes(p))continue;const gn=F(p),j=a(u.filter(k=>(k.visitedUnion&gn)!==0n).map(k=>k.position)).size;if(j>=H)continue;const wn=f([...d,p].sort((k,hn)=>k-hn));H=Math.min(H,Math.max(j,wn))}return c.set(C,H),H};l.set(h.id,g-f([]))}return o.set(t,l),I.set(n,o),l};self.onmessage=n=>{const{evidence:i,nextStreetPositions:t}=n.data;self.postMessage(fn(i,t))}})();
