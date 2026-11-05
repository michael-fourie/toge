"""The four TŌGE drivers. Each is a MakeHuman body (realistic proportions from MPFB's phenotype
sliders), recoloured MakeHuman clothes, and a kit of brass-and-neon parts from kit.py.

Recolour rules pick pixels of a texture by hue / saturation / value (and optionally a UV box) and
repaint them in a new colour, keeping the cloth's shading. `emit` makes the picked pixels glow.
Material arguments to kit pieces are written '@name' (a palette entry); plain strings are palette keys.
Ages: MakeHuman's 0.5 is 25 years, 1.0 is 90.
"""

MARLOWE = {
    'name': 'Marlowe Vance',
    'theme': '#ffae3c',  # amber
    'phenotype': {'gender': 1.0, 'age': 0.73, 'muscle': 0.56, 'weight': 0.46, 'proportions': 0.8, 'height': 0.6,
                  'race': {'caucasian': 0.92, 'asian': 0.04, 'african': 0.04}},
    'skin': 'middleage_caucasian_male',
    'eyes': 'grey',
    'eyebrows': 'eyebrow007',
    'eyelashes': 'eyelashes02',
    'hair': 'short02',
    'clothes': ['male_elegantsuit01', 'shoes03'],
    'sleeveless': ['r'],
    'recolor': {
        # A bottle-green tailcoat suit, cream shirt, amber silk tie.
        'male_elegantsuit01': [
            {'uv': (0.76, 0.74, 0.87, 1.0), 'val': (0.0, 0.85), 'color': '#b8862b'},
            {'val': (0.0, 0.45), 'sat': (0.0, 0.6), 'color': '#1f3a2c'},
            {'val': (0.6, 1.0), 'sat': (0.0, 0.25), 'color': '#e9dcc0'},
        ],
        'short02': [{'color': '#8d8a85', 'contrast': 1.3}],
        'shoes03': [{'color': '#2a1a10'}],
    },
    'kit': [
        ('goggles', {'lens': '@glass', 'single': '@lens', 'where': 'forehead', 'lift': 0.062, 'tilt': 0.45, 'strap': 'leather'}),
        ('mech_arm', {'side': 'r', 'glow': '@glow', 'metal': 'gunmetal', 'plate': 'brass'}),
        ('gloves', {'sides': ('l',), 'material': 'leather', 'cuff': 'brass'}),
        ('collar', {'metal': 'brass', 'bands': 1, 'height': 0.012}),
    ],
    'drive': {'recline': 21, 'reach': 0.95, 'wheel_drop': 0.12},
    'seat': {'leather': 'leather', 'trim': 'brass'},
    'wheel': {'kind': 'wood', 'radius': 0.19},
    'idle': {'stance': 'behind', 'weight': 1, 'head_turn': 6},
}

KIRIKA = {
    'name': 'Kirika Sato',
    'theme': '#ff2fd2',  # magenta
    'phenotype': {'gender': 0.0, 'age': 0.48, 'muscle': 0.62, 'weight': 0.4, 'proportions': 0.75, 'height': 0.45,
                  'cupsize': 0.45, 'firmness': 0.6, 'race': {'asian': 0.95, 'caucasian': 0.05, 'african': 0.0}},
    'skin': 'young_asian_female',
    'eyes': 'brown',
    'eyebrows': 'eyebrow010',
    'eyelashes': 'eyelashes04',
    'hair': 'bob02',
    'clothes': ['female_sportsuit01', 'shoes05'],
    'recolor': {
        # Black racing top and leggings; the leggings' side stripe glows.
        'female_sportsuit01': [
            {'hue': (0.03, 0.16), 'sat': (0.5, 1.0), 'color': '#ff2fd2', 'emit': '#ff2fd2'},
            {'val': (0.85, 1.0), 'sat': (0.0, 0.15), 'color': '#ff2fd2', 'emit': '#ff2fd2'},
            {'hue': (0.5, 0.75), 'sat': (0.25, 1.0), 'color': '#18171d'},
            {'val': (0.0, 0.6), 'color': '#121116'},
        ],
        'bob02': [{'color': '#e6e9f2'}],
        'shoes05': [{'val': (0.5, 1.0), 'color': '#202027'}, {'val': (0.0, 0.5), 'color': '#ff2fd2'}],
    },
    'kit': [
        ('respirator', {'glow': '@glow'}),
        ('implants', {'glow': '@glow', 'side': 1, 'count': 4}),
        ('mech_arm', {'side': 'l', 'glow': '@glow', 'metal': 'carbon', 'plate': 'gunmetal'}),
        ('gloves', {'sides': ('r',), 'material': 'leather_black', 'cuff': 'gunmetal', 'fingerless': True}),
        ('collar', {'metal': 'gunmetal', 'bands': 2, 'height': 0.03, 'glow': '@glow'}),
    ],
    'drive': {'recline': 24, 'reach': 0.93, 'wheel_drop': 0.1},
    'seat': {'leather': 'leather_black', 'trim': 'gunmetal', 'glow': True},
    'wheel': {'kind': 'yoke', 'radius': 0.17},
    'idle': {'stance': {'l': 'relaxed', 'r': 'hip'}, 'weight': -1, 'head_turn': -8},
}

OKONKWO = {
    'name': 'Okonkwo Adeyemi',
    'theme': '#3dff8e',  # boiler green
    'phenotype': {'gender': 1.0, 'age': 0.6, 'muscle': 0.9, 'weight': 0.62, 'proportions': 0.6, 'height': 0.62,
                  'race': {'african': 0.95, 'caucasian': 0.03, 'asian': 0.02}},
    'skin': 'middleage_african_male',
    'eyes': 'brownlight',
    'eyebrows': 'eyebrow003',
    'eyelashes': 'eyelashes01',
    'hair': 'short04',
    'clothes': ['male_worksuit01', 'shoes03'],
    'recolor': {
        # Oiled canvas overalls in rust brown, a charcoal tee.
        'male_worksuit01': [
            {'hue': (0.5, 0.75), 'sat': (0.12, 1.0), 'color': '#5a3420'},
            {'sat': (0.0, 0.2), 'val': (0.4, 1.0), 'color': '#2b2b2e'},
        ],
        'short04': [{'color': '#141110'}],
        'shoes03': [{'color': '#1c1410'}],
    },
    'kit': [
        ('goggles', {'lens': '@lens', 'where': 'forehead', 'lift': 0.07, 'tilt': 0.5, 'strap': 'leather_tan'}),
        ('pauldron', {'side': 'l', 'metal': 'copper', 'glow': '@lens'}),
        ('bracer', {'side': 'r', 'metal': 'brass', 'strap': 'leather_tan', 'gauge': '@lens'}),
        ('bracer', {'side': 'l', 'metal': 'copper', 'strap': 'leather_tan'}),
        ('gloves', {'sides': ('l', 'r'), 'material': 'leather_tan', 'cuff': 'leather_tan', 'fingerless': True}),
        ('belt', {'material': 'leather_tan', 'buckle': 'brass', 'z_frac': 0.55}),
    ],
    'drive': {'recline': 20, 'reach': 0.95, 'wheel_drop': 0.13},
    'seat': {'leather': 'leather_tan', 'trim': 'copper'},
    'wheel': {'kind': 'iron', 'radius': 0.2},
    'idle': {'stance': 'relaxed', 'weight': 1, 'head_turn': 10},
}

INES = {
    'name': 'Inès Varga',
    'theme': '#ff3b30',  # signal red
    'phenotype': {'gender': 0.0, 'age': 0.6, 'muscle': 0.5, 'weight': 0.38, 'proportions': 0.85, 'height': 0.62,
                  'cupsize': 0.5, 'firmness': 0.6, 'race': {'caucasian': 0.75, 'african': 0.1, 'asian': 0.15}},
    'skin': 'young_caucasian_female',
    'eyes': 'ice',
    'eyebrows': 'eyebrow001',
    'eyelashes': 'eyelashes03',
    'hair': 'ponytail01',
    'clothes': ['male_casualsuit05', 'shoes03'],
    'recolor': {
        # Black leather jacket, blood-red shirt, charcoal jeans.
        'male_casualsuit05': [
            {'uv': (0.0, 0.0, 0.6, 0.45), 'color': '#25252a', 'contrast': 0.6},
            {'hue': (0.8, 0.06), 'sat': (0.3, 1.0), 'color': '#b3121e'},
            {'hue': (0.15, 0.55), 'sat': (0.03, 1.0), 'color': '#17130f', 'contrast': 1.2},
        ],
        'ponytail01': [{'color': '#6e0d16'}],
        'shoes03': [{'color': '#121010'}],
    },
    'kit': [
        ('monocle', {'lens': '@lens', 'side': -1}),
        ('implants', {'glow': '@glow', 'side': 1, 'count': 3}),
        ('collar', {'metal': 'gunmetal', 'bands': 3, 'height': 0.045, 'glow': '@glow'}),
        ('gloves', {'sides': ('l', 'r'), 'material': 'leather_black', 'cuff': 'chrome'}),
        ('chest_strap', {'side': 'l', 'material': 'leather_black', 'buckle': 'chrome'}),
    ],
    'drive': {'recline': 23, 'reach': 0.94, 'wheel_drop': 0.11},
    'seat': {'leather': 'leather_black', 'trim': 'chrome'},
    'wheel': {'kind': 'deep', 'radius': 0.175},
    'idle': {'stance': {'l': 'hip', 'r': 'relaxed'}, 'weight': -1, 'head_turn': 12},
}

CAST = {'marlowe': MARLOWE, 'kirika': KIRIKA, 'okonkwo': OKONKWO, 'ines': INES}
