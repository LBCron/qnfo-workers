r"""
exec_safe.py — Run cmd.exe commands through Python subprocess.

Solves the DeepChat cmd.exe space-splitting bug (Node.js spawn quotes " as \"
which cmd.exe /c misparses). Python subprocess.run handles quoting correctly.

Usage:
  exec python C:\Users\LENOVO\.deepchat\scripts\exec_safe.py "cmd arg1 arg2 ..."
  exec python C:\Users\LENOVO\.deepchat\scripts\exec_safe.py --cwd D:\path "cmd ..."
  exec python C:\Users\LENOVO\.deepchat\scripts\exec_safe.py --pipe "cmd1" "cmd2"

Flags:
  --cwd DIR     Set working directory (default: same as DeepChat workspace)
  --pipe        Pipe stdout of cmd1 to stdin of cmd2
  --file PATH   Read command from file (avoids DeepChat exec quoting bug entirely)
  --stdin       Read command from stdin
  --timeout N   Timeout in seconds (default: 300)
  --tee FILE    Also write stdout to FILE

Examples:
  # Safe: read command from file (no quoting issues)
  exec python C:\Users\LENOVO\.deepchat\scripts\exec_safe.py --file %TEMP%\_cmd.txt
  # Safe: read command from stdin
  exec echo dir "C:\Program Files" /b | python C:\Users\LENOVO\.deepchat\scripts\exec_safe.py --stdin
  # Only safe if command has NO spaces/special chars
  exec python C:\Users\LENOVO\.deepchat\scripts\exec_safe.py "git status"
"""
import subprocess
import sys
import os
import argparse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', nargs='*', help='Command(s) to execute (inline mode)')
    parser.add_argument('--cwd', default=None, help='Working directory')
    parser.add_argument('--pipe', action='store_true', help='Pipe cmd1 stdout to cmd2 stdin')
    parser.add_argument('--file', default=None, help='Read command from file')
    parser.add_argument('--stdin', action='store_true', help='Read command from stdin')
    parser.add_argument('--timeout', type=int, default=300, help='Timeout in seconds')
    parser.add_argument('--tee', default=None, help='Also write stdout to file')
    args = parser.parse_args()

    # Determine the command to run
    if args.stdin:
        cmd = sys.stdin.read().strip()
        if not cmd:
            print("exec_safe: no command on stdin", file=sys.stderr)
            sys.exit(1)
        # Strip any chcp preamble that leaked through
        if cmd.startswith('chcp '):
            idx = cmd.find('&&')
            if idx >= 0:
                cmd = cmd[idx + 2:].strip()
    elif args.file:
        with open(args.file, 'r', encoding='utf-8') as f:
            cmd = f.read().strip()
    else:
        cmd = ' '.join(args.command)

    if args.pipe and len(args.command) != 2:
        print("--pipe requires exactly 2 commands", file=sys.stderr)
        sys.exit(1)

    if args.pipe:
        p1 = subprocess.Popen(
            args.command[0],
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=args.cwd,
            text=True,
        )
        stdout1, stderr1 = p1.communicate(timeout=args.timeout)
        if stderr1:
            print(stderr1, end='', file=sys.stderr)

        p2 = subprocess.run(
            args.command[1],
            shell=True,
            input=stdout1,
            capture_output=True,
            text=True,
            cwd=args.cwd,
            timeout=args.timeout,
        )
        print(p2.stdout, end='')
        if p2.stderr:
            print(p2.stderr, end='', file=sys.stderr)
        sys.exit(p2.returncode)
    else:
        # Use the already-derived `cmd` (from --file/--stdin/inline). Re-joining
        # args.command here would run an EMPTY command for file/stdin modes.
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            cwd=args.cwd,
            timeout=args.timeout,
        )
        print(result.stdout, end='')
        if result.stderr:
            print(result.stderr, end='', file=sys.stderr)
        if args.tee:
            tee_dir = os.path.dirname(args.tee)
            if tee_dir and not os.path.exists(tee_dir):
                os.makedirs(tee_dir, exist_ok=True)
            with open(args.tee, 'w', encoding='utf-8') as f:
                f.write(result.stdout)
        sys.exit(result.returncode)


if __name__ == '__main__':
    main()
