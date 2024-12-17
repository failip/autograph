import json

symbol_to_color = {}
number_to_color = {}

with open('colors.txt', 'r') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        splitted = line.split()
        symbol = splitted[1]
        atomic_number = int(splitted[0])
        color = splitted[3]
        hex_color = '#%s' % color
        symbol_to_color[symbol] = hex_color
        number_to_color[atomic_number] = hex_color

with open('symbol_to_color.json', 'w') as f:
    json.dump(symbol_to_color, f)

with open('number_to_color.json', 'w') as f:
    json.dump(number_to_color, f)