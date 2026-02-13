# Packet Diagram

**Declaration:** `packet-beta`

## Basic Syntax

```
packet-beta
    0-15: "Source Port"
    16-31: "Destination Port"
    32-63: "Sequence Number"
    64-95: "Acknowledgment Number"
```

## Field Format

- Single-bit: `position: "description"`
- Multi-bit range: `start-end: "description"`

## Bits Syntax (v11.7.0+)

Automatic bit counting with `+<count>`:

```
packet-beta
    +1: "Block name"
    +8: "Block name"
    9-15: "Manually set start and end"
```

`+<count>` automatically continues from the previous field's endpoint, reducing errors when modifying fields.

## Example: TCP Header

```
packet-beta
    0-15: "Source Port"
    16-31: "Destination Port"
    32-63: "Sequence Number"
    64-95: "Acknowledgment Number"
    96-99: "Data Offset"
    100-105: "Reserved"
    106: "URG"
    107: "ACK"
    108: "PSH"
    109: "RST"
    110: "SYN"
    111: "FIN"
    112-127: "Window Size"
    128-143: "Checksum"
    144-159: "Urgent Pointer"
```
