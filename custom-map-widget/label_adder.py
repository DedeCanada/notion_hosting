import json

def enhance_paths_with_labels(data):
    # Create a lookup dictionary using lat,lng as the key
    coord_to_label = {
        f"{p['lat']:.6f},{p['lng']:.6f}": p.get('label', '')
        for p in data.get("points", [])
    }

    for path in data.get("paths", []):
        for point in path.get("points", []):
            key = f"{point['lat']:.6f},{point['lng']:.6f}"
            if "label" not in point and key in coord_to_label and coord_to_label[key]:
                point["label"] = coord_to_label[key]

    return data

def main():
    input_file = "data.json"
    output_file = "data_enhanced.json"

    with open(input_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    enhanced_data = enhance_paths_with_labels(data)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(enhanced_data, f, indent=2)
    
    print(f"Enhanced JSON written to {output_file}")

if __name__ == "__main__":
    main()
